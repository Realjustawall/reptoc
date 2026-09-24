import express from "express";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../../postgres";
import { enforceAdmin, getActiveUser } from "../../utils/auth";
import { sanitizePlainText } from "../../utils/content";
import { interactionLimiter } from "../limiters";

const router = express.Router();

function mapContest(row: any) {
  return {
    id: row.id,
    title: row.title,
    theme: row.theme,
    description: row.description || "",
    rules: row.rules || "",
    prize: row.prize || "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status || "active"
  };
}

router.get("/", async (_req, res) => {
  try {
    const { data } = await supabase
      .from("contests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    res.json({ contests: (data || []).map(mapContest) });
  } catch {
    res.status(400).json({ error: "بارگذاری مسابقه‌ها ناموفق بود." });
  }
});

router.get("/active", async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const { data } = await supabase
      .from("contests")
      .select("*")
      .eq("status", "active")
      .lte("starts_at", now)
      .gte("ends_at", now)
      .order("ends_at", { ascending: true })
      .limit(1);
    res.json({ contest: data?.[0] ? mapContest(data[0]) : null });
  } catch {
    res.status(400).json({ error: "بارگذاری مسابقه فعال ناموفق بود." });
  }
});

router.get("/:id/submissions", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const { data: contest } = await supabase.from("contests").select("id").eq("id", req.params.id).single();
    if (!contest) return res.status(404).json({ error: "مسابقه یافت نشد." });

    let query = supabase
      .from("contest_submissions")
      .select("*, users!inner(username, avatar), novels(title)")
      .eq("contest_id", req.params.id)
      .order("submitted_at", { ascending: false });

    const normalizedRole = String(user?.role || "").toLowerCase().trim();
    if (!user || !["owner", "publisher", "editor"].includes(normalizedRole)) {
      query = query.eq("status", "accepted");
    }

    const { data } = await query;
    res.json({
      submissions: (data || []).map((row: any) => ({
        id: row.id,
        contestId: row.contest_id,
        userId: row.user_id,
        username: row.users?.username,
        avatar: row.users?.avatar,
        novelId: row.novel_id,
        novelTitle: row.novels?.title,
        title: row.title,
        synopsis: row.synopsis || "",
        contentUrl: row.content_url || "",
        status: row.status,
        score: row.score || 0,
        judgeNote: row.judge_note || "",
        submittedAt: row.submitted_at
      }))
    });
  } catch {
    res.status(400).json({ error: "بارگذاری آثار ارسالی مسابقه ناموفق بود." });
  }
});

router.post("/:id/submissions", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    // ✅ Use database-level constraints to prevent race conditions
    // First, verify contest is open and get contest details atomically
    let now = new Date().toISOString();
    const { data: contest, error: contestError } = await supabase
      .from("contests")
      .select("id, starts_at, ends_at, status")
      .eq("id", req.params.id)
      .eq("status", "active")
      .lte("starts_at", now)
      .gte("ends_at", now)
      .single();
    
    if (contestError || !contest) {
      return res.status(404).json({ error: "مسابقه در حال حاضر باز نیست." });
    }

    const title = sanitizePlainText(req.body.title, 160).trim();
    const synopsis = sanitizePlainText(req.body.synopsis, 5000).trim();
    const novelId = sanitizePlainText(req.body.novelId, 160).trim() || null;
    const contentUrl = sanitizePlainText(req.body.contentUrl, 1000).trim();
    
    if (!title || synopsis.length < 20) {
      return res.status(400).json({ error: "عنوان و خلاصه‌ای معنادار الزامی است." });
    }

    if (novelId) {
      const { data: novel } = await supabase.from("novels").select("author_id").eq("id", novelId).single();
      if (!novel || novel.author_id !== user.id) {
        return res.status(403).json({ error: "فقط می‌توانید رمان خودتان را برای این مسابقه ارسال کنید." });
      }
    }

    // ✅ Check if user already submitted (use RLS or app-level check)
    const { data: existingSubmission } = await supabase
      .from("contest_submissions")
      .select("id")
      .eq("contest_id", req.params.id)
      .eq("user_id", user.id)
      .single();

    if (existingSubmission) {
      return res.status(400).json({ error: "قبلاً اثر خود را به این مسابقه ارسال کرده‌اید." });
    }

    // ✅ Insert with database-level constraint validation
    // The database should have a check constraint:
    // CHECK (ends_at > NOW()) on contest_submissions to prevent late submissions
    now = new Date().toISOString();
    const { data: submission, error: insertError } = await supabase
      .from("contest_submissions")
      .insert({
        id: `cs-${uuidv4()}`,
        contest_id: req.params.id,
        user_id: user.id,
        novel_id: novelId,
        title,
        synopsis,
        content_url: contentUrl,
        status: "submitted",
        submitted_at: now
      })
      .select();

    // If insert fails due to contest being closed or unique constraint, handle gracefully.
    if (insertError) {
      const code = String(insertError.code || "");
      const message = String(insertError.message || "");
      // ✅ SECURITY: Handle unique-constraint violations from race condition.
      // Migration 069 adds UNIQUE(contest_id, user_id) which means concurrent
      // submissions from the same user are rejected at the DB level.
      if (code === '23505' || /contest_submissions_user_unique/i.test(message)) {
        return res.status(400).json({ error: "قبلاً اثر خود را به این مسابقه ارسال کرده‌اید." });
      }
      if (message.includes('check constraint')) {
        return res.status(400).json({ error: "مهلت ارسال اثر به این مسابقه به پایان رسیده است. لطفاً با آغاز مسابقه بعدی دوباره تلاش کنید." });
      }
      throw insertError;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Contest submission error:", err);
    res.status(400).json({ error: "ارسال اثر به مسابقه ناموفق بود." });
  }
});

router.post("/", enforceAdmin, async (req, res) => {
  try {
    const startsAt = req.body.startsAt ? new Date(req.body.startsAt) : new Date();
    const endsAt = req.body.endsAt ? new Date(req.body.endsAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return res.status(400).json({ error: "تاریخ پایان مسابقه باید پس از تاریخ شروع باشد." });

    const title = sanitizePlainText(req.body.title, 160).trim();
    const theme = sanitizePlainText(req.body.theme, 160).trim();
    if (!title || !theme) return res.status(400).json({ error: "عنوان و موضوع الزامی است." });

    const id = req.body.id ? sanitizePlainText(req.body.id, 160) : `contest-${uuidv4()}`;
    await supabase.from("contests").upsert({
      id,
      title,
      theme,
      description: sanitizePlainText(req.body.description, 5000),
      rules: sanitizePlainText(req.body.rules, 5000),
      prize: sanitizePlainText(req.body.prize, 1000),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: ["active", "draft", "closed"].includes(req.body.status) ? req.body.status : "active",
      created_by: res.locals.user?.id || null
    });

    res.json({ success: true, id });
  } catch {
    res.status(400).json({ error: "ذخیره مسابقه ناموفق بود." });
  }
});

router.patch("/submissions/:submissionId", enforceAdmin, async (req, res) => {
  try {
    const updates: any = {};
    if (["submitted", "accepted", "rejected", "winner"].includes(req.body.status)) updates.status = req.body.status;
    if (req.body.score !== undefined) updates.score = Math.max(0, Math.min(100, Number(req.body.score) || 0));
    if (req.body.judgeNote !== undefined) updates.judge_note = sanitizePlainText(req.body.judgeNote, 5000);
    await supabase.from("contest_submissions").update(updates).eq("id", req.params.submissionId);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "به‌روزرسانی اثر ارسالی ناموفق بود." });
  }
});

export default router;
