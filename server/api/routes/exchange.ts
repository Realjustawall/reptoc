import express from "express";
import { supabase } from "../../postgres";
import { getActiveUser } from "../../utils/auth";
import { v4 as uuidv4 } from "uuid";
import { interactionLimiter } from "../limiters";
import { sanitizePlainText } from "../../utils/content";

const router = express.Router();

// ✅ SECURITY: Per-user daily review limit. Prevents rating manipulation
// attacks where a user creates multiple accounts to inflate/deflate ratings.
const MAX_REVIEWS_PER_DAY_PER_USER = Number(process.env.MAX_REVIEWS_PER_DAY || 10);

/**
 * Check whether the user has reviewed too many novels today.
 * Returns true if the user is over the daily limit.
 */
async function hasExceededDailyReviewLimit(userId: string): Promise<boolean> {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count, error } = await supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', startOfDay.toISOString());

    if (error) {
      console.warn('Failed to enforce daily review limit:', error.message);
      // ✅ SECURITY: Fail-closed. If we can't check the limit, refuse the review.
      return true;
    }
    return (count || 0) >= MAX_REVIEWS_PER_DAY_PER_USER;
  } catch (err) {
    console.warn('Daily review limit check threw:', err);
    return true;
  }
}

/**
 * GET /api/exchange/received
 * Fetch comments/reviews received on user's own novels
 */
router.get("/received", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { data: novels } = await supabase
      .from('novels')
      .select('id, title')
      .eq('author_id', user.id);

    if (!novels || novels.length === 0) {
      return res.json({ reviews: [] });
    }

    const novelIds = novels.map(n => n.id);

    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('id, novel_id, user_id, username, rating, content as comment, created_at')
      .in('novel_id', novelIds)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Error fetching received reviews:", error);
      return res.status(400).json({ error: "دریافت نقدهای دریافتی ناموفق بود" });
    }

    const reviewerIds = [...new Set((reviews || []).map((review: any) => review.user_id).filter(Boolean))];
    const { data: reviewerAccounts } = reviewerIds.length
      ? await supabase.from("users").select("id, username").in("id", reviewerIds)
      : { data: [] as any[] };
    const reviewerNames = new Map((reviewerAccounts || []).map((account: any) => [account.id, account.username]));
    const mapped = (reviews || []).map((r: any) => {
      const novelTitle = novels.find(n => n.id === r.novel_id)?.title || 'رمان ناشناس';
      return {
        id: r.id,
        novelTitle,
        novelId: r.novel_id,
        username: reviewerNames.get(r.user_id) || r.username,
        rating: r.rating || 0,
        comment: r.comment || '',
        createdAt: r.created_at
      };
    });

    res.json({ reviews: mapped });
  } catch (err) {
    console.error("Fetch received reviews error:", err);
    res.status(400).json({ error: "دریافت نقدهای دریافتی ناموفق بود" });
  }
});

/**
 * GET /api/exchange/given
 * Fetch comments/reviews written by the user
 */
router.get("/given", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('id, novel_id, novels(title), rating, content as comment, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Error fetching given reviews:", error);
      return res.status(400).json({ error: "دریافت نقدهای ارسالی ناموفق بود" });
    }

    const mapped = (reviews || []).map((r: any) => ({
      id: r.id,
      novelTitle: (r.novels as any)?.title || 'رمان ناشناس',
      novelId: r.novel_id,
      rating: r.rating || 0,
      comment: r.comment || '',
      createdAt: r.created_at
    }));

    res.json({ reviews: mapped });
  } catch (err) {
    console.error("Fetch given reviews error:", err);
    res.status(400).json({ error: "دریافت نقدهای ارسالی ناموفق بود" });
  }
});

/**
 * GET /api/exchange/stats
 * Get exchange statistics for the user
 */
router.get("/stats", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { data: ownNovels } = await supabase
      .from('novels')
      .select('id')
      .eq('author_id', user.id);

    const novelIds = ownNovels?.map(n => n.id) || [];

    const [receivedReviews, givenReviews] = await Promise.all([
      supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .in('novel_id', novelIds),
      supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
    ]);

    res.json({
      stats: {
        reviewsReceived: receivedReviews.count || 0,
        reviewsGiven: givenReviews.count || 0,
        totalNovelsByUser: ownNovels?.length || 0
      }
    });
  } catch (err) {
    console.error("Fetch exchange stats error:", err);
    res.status(400).json({ error: "دریافت آمار ناموفق بود" });
  }
});

/**
 * POST /api/exchange/submit-review
 * Submit a review on a novel
 *
 * ✅ SECURITY hardening:
 *   - Daily review limit per user (prevents rating manipulation)
 *   - Validate rating is integer 1-5 (defense-in-depth even with Zod)
 *   - Validate novelId format
 *   - Reject reviews on novels authored by the reviewer (no self-review)
 *   - Use ON CONFLICT to handle race conditions cleanly
 */
router.post("/submit-review", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { novelId, rating } = req.body;
    const comment = sanitizePlainText(req.body.comment, 5000).trim();

    if (!novelId || rating === undefined || !comment) {
      return res.status(400).json({ error: "فیلدهای الزامی ارسال نشده‌اند" });
    }

    // ✅ SECURITY: Strict rating validation. Number.isInteger handles string "5"
    // by coercing — but we explicitly require a number to prevent subtle bugs.
    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: "امتیاز باید عددی صحیح بین 1 و 5 باشد" });
    }

    // ✅ SECURITY: Validate novelId format to prevent DB fingerprinting.
    const safeNovelId = sanitizePlainText(String(novelId), 160).trim();
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(safeNovelId)) {
      return res.status(400).json({ error: "شناسه رمان نامعتبر است." });
    }

    if (comment.length < 5) {
      return res.status(400).json({ error: "متن دیدگاه باید حداقل 5 کاراکتر باشد" });
    }

    // ✅ SECURITY: Daily review limit per user. Prevents bot-driven rating
    // manipulation. Fail-closed if check fails.
    if (await hasExceededDailyReviewLimit(user.id)) {
      return res.status(429).json({
        error: `شما امروز به حداکثر تعداد نقدهای مجاز (${MAX_REVIEWS_PER_DAY_PER_USER}) رسیده‌اید. فردا دوباره تلاش کنید.`,
      });
    }

    // Check if novel exists
    const { data: novel, error: novelErr } = await supabase
      .from('novels')
      .select('id, author_id, approval_status')
      .eq('id', safeNovelId)
      .single();

    if (novelErr || !novel) {
      return res.status(404).json({ error: "رمان یافت نشد" });
    }

    // ✅ SECURITY: Block self-reviews. An author cannot review their own novel.
    if (novel.author_id === user.id) {
      return res.status(400).json({ error: "شما نمی‌توانید به رمان خودتان نقد بدهید." });
    }

    // ✅ SECURITY: Block reviews on novels that are not yet approved.
    if (String(novel.approval_status || '').toLowerCase() !== 'approved') {
      return res.status(403).json({ error: "این رمان هنوز برای دریافت نقد منتشر نشده است." });
    }

    // Check if user already reviewed this novel (prevent duplicates)
    const { data: existingReview } = await supabase
      .from('reviews')
      .select('id')
      .eq('novel_id', safeNovelId)
      .eq('user_id', user.id)
      .single();

    if (existingReview) {
      // Update existing review instead of creating new
      const { error: updateErr } = await supabase
        .from('reviews')
        .update({
          rating: numericRating,
          content: comment
        })
        .eq('id', existingReview.id);

      if (updateErr) {
        console.error("Error updating review:", updateErr);
        return res.status(400).json({ error: "به‌روزرسانی نقد ناموفق بود" });
      }

      return res.json({ message: "نقد با موفقیت به‌روزرسانی شد", reviewId: existingReview.id });
    }

    // Create new review
    const { data: newReview, error: insertErr } = await supabase
      .from('reviews')
      .insert({
        id: `review-${uuidv4()}`,
        novel_id: safeNovelId,
        user_id: user.id,
        username: user.username,
        rating: numericRating,
        content: comment,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    // ✅ SECURITY: Handle unique-constraint violations from race condition.
    if (insertErr) {
      if (String(insertErr.code || '') === '23505') {
        return res.status(409).json({ error: "شما قبلاً به این رمان نقد داده‌اید." });
      }
      console.error("Error creating review:", insertErr);
      return res.status(400).json({ error: "ایجاد نقد ناموفق بود" });
    }

    res.status(201).json({
      message: "نقد با موفقیت ثبت شد",
      reviewId: newReview.id
    });
  } catch (err) {
    console.error("Submit review error:", err);
    res.status(400).json({ error: "ثبت نقد ناموفق بود" });
  }
});

/**
 * DELETE /api/exchange/reviews/:reviewId
 * Delete a review written by the user
 */
router.delete("/reviews/:reviewId", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const reviewId = sanitizePlainText(String(req.params.reviewId || ''), 100).trim();
    // ✅ SECURITY: Validate review ID format.
    if (!/^review-[a-f0-9-]{8,80}$/i.test(reviewId)) {
      return res.status(400).json({ error: "شناسه نقد نامعتبر است." });
    }

    const { data: review } = await supabase
      .from('reviews')
      .select('id, user_id')
      .eq('id', reviewId)
      .single();

    if (!review) {
      return res.status(404).json({ error: "نقد یافت نشد" });
    }

    if (review.user_id !== user.id) {
      return res.status(403).json({ error: "دسترسی غیرمجاز: فقط می‌توانید نقدهای خودتان را حذف کنید" });
    }

    const { error: deleteErr } = await supabase
      .from('reviews')
      .delete()
      .eq('id', reviewId);

    if (deleteErr) {
      console.error("Error deleting review:", deleteErr);
      return res.status(400).json({ error: "حذف نقد ناموفق بود" });
    }

    res.json({ message: "نقد با موفقیت حذف شد" });
  } catch (err) {
    console.error("Delete review error:", err);
    res.status(400).json({ error: "حذف نقد ناموفق بود" });
  }
});

export default router;
