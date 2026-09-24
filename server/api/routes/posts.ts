import express from "express";
import { supabase } from "../../postgres";
import { getActiveUser, requireVerifiedEmailForWriting } from "../../utils/auth";
import { canManageNovel, canUserViewNovel } from "../../utils/chapters";
import { sanitizePlainText } from "../../utils/content";
import { notifyFollowersOfTarget } from "../../utils/notifications";
import { resolveUsername } from "../../utils/usernames";

const router = express.Router();

// Get author posts
router.get("/", async (req, res) => {
  try {
    const { novel_id } = req.query;
    
    let query = supabase.from('author_posts').select('*').order('created_at', { ascending: false });
    
    if (novel_id) {
        const user = await getActiveUser(req, false);
        const safeNovelId = sanitizePlainText(novel_id, 160).trim();
        const { data: novel } = await supabase
          .from('novels')
          .select('id, author_id, approved_by, approval_status')
          .eq('id', safeNovelId)
          .single();
        if (!novel || !canUserViewNovel(novel, user)) {
          return res.status(404).json({ error: "رمان یافت نشد" });
        }
        query = query.eq('novel_id', safeNovelId);
    } else {
        // If no novel_id, check if user is asking for their own posts
        const user = await getActiveUser(req);
        if (user) {
             query = query.eq('author_id', user.id);
        } else {
             return res.json({ posts: [] });
        }
    }
    
    const { data: posts } = await query;
    const processPosts = (dbPosts: any[]) => dbPosts.map(p => {
        try {
            const parsed = JSON.parse(p.content);
            return { ...p, title: parsed.title || "اطلاعیه", content: parsed.content || p.content };
        } catch(e) {
            return { ...p, title: "اطلاعیه" };
        }
    });
    res.json({ posts: posts ? processPosts(posts) : [] });
  } catch (err) {
    res.status(400).json({ error: "دریافت پست‌ها ناموفق بود" });
  }
});

// Also support fetching by generic author parameter
router.get("/author/:authorName", async (req, res) => {
  try {
    const { authorName } = req.params;
    const author = await resolveUsername(authorName);
    if (author) {
        const { data: posts } = await supabase
          .from('author_posts')
          .select('*')
          .eq('author_id', author.id)
          .order('created_at', { ascending: false });
          
        const processPosts = (dbPosts: any[]) => dbPosts.map(p => {
            try {
                const parsed = JSON.parse(p.content);
                return { ...p, title: parsed.title || "اطلاعیه", content: parsed.content || p.content };
            } catch(e) {
                return { ...p, title: "اطلاعیه" };
            }
        });
        res.json({ posts: posts ? processPosts(posts) : [] });
    } else {
        res.json({ posts: [] });
    }
  } catch (err) {
    res.status(400).json({ error: "دریافت پست‌ها ناموفق بود" });
  }
});

// Create a post
router.post("/", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    const emailGateError = await requireVerifiedEmailForWriting(user);
    if (emailGateError) return res.status(403).json({ error: emailGateError });

    const { title, content, novel_id } = req.body;
    const safeTitle = sanitizePlainText(title || "اطلاعیه", 160).trim() || "اطلاعیه";
    const safeContent = sanitizePlainText(content, 5000).trim();
    const safeNovelId = novel_id ? sanitizePlainText(novel_id, 160).trim() : "";
    if (!safeContent) return res.status(400).json({ error: "محتوا الزامی است" });

    let novelForPost: any = null;
    if (safeNovelId) {
      const { data: novel } = await supabase
        .from('novels')
        .select('id, title, author_id, approved_by, approval_status')
        .eq('id', safeNovelId)
        .single();
      if (!novel) return res.status(404).json({ error: "رمان یافت نشد" });
      if (!canManageNovel(user, novel)) {
        return res.status(403).json({ error: "فقط نویسنده رمان یا همکاران تعیین‌شده می‌توانند برای این رمان پست منتشر کنند." });
      }
      novelForPost = novel;
    }

    const finalContent = JSON.stringify({ title: safeTitle, content: safeContent });

    const postData: any = {
      id: "post-" + Date.now() + Math.random().toString(36).substr(2, 5),
      author_id: user.id,
      content: finalContent
    };
    if (novelForPost) postData.novel_id = novelForPost.id;

    await supabase.from('author_posts').insert(postData);

    // Notify followers
    let targetType = 'user';
    let targetId = user.id;
    let notificationText = `${user.username} تازه یک پست جدید منتشر کرد!`;
    let notificationLink = `/authors/${user.username}`;
    
    if (novelForPost) {
       targetType = 'novel';
       targetId = novelForPost.id;
       notificationText = `پست جدید برای ${novelForPost.title}`;
       notificationLink = `/reader/${novelForPost.id}`;
    }

    await notifyFollowersOfTarget(targetType as "user" | "novel", targetId, "author_post", "پست جدید", notificationText, notificationLink, "notify_followers");

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ایجاد پست ناموفق بود" });
  }
});

export default router;
