import express from "express";
import { supabase } from "../../postgres";
import { getActiveUser, isOwnerUser } from "../../utils/auth";
import { createUserNotification, ensureNotificationTable } from "../../utils/notifications";
import { z } from "zod";
import { interactionLimiter } from "../limiters";
import { getWebPushPublicKey, hasWebPushSubscription, removeWebPushSubscription, saveWebPushSubscription } from "../../utils/webPush";

const router = express.Router();

router.get("/push/config", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    res.json({ supported: true, publicKey: await getWebPushPublicKey(), subscribed: await hasWebPushSubscription(user.id) });
  } catch (error: any) {
    console.error("Push config failed", error?.message || error);
    res.status(503).json({ error: "راه‌اندازی اعلان Push انجام نشد." });
  }
});

router.post("/push/subscribe", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await saveWebPushSubscription(user.id, req.body?.subscription, String(req.headers["user-agent"] || ""));
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "فعال‌سازی اعلان Push ناموفق بود." });
  }
});

router.post("/push/unsubscribe", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await removeWebPushSubscription(user.id, String(req.body?.endpoint || "").trim() || undefined);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "غیرفعال‌سازی اعلان Push ناموفق بود." });
  }
});

const verifyNotificationOwnership = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await ensureNotificationTable();

    const { data: notif } = await supabase
      .from('notifications')
      .select('user_id')
      .eq('id', req.params.id)
      .single();
      
    if (!notif) return res.status(404).json({ error: "اعلان یافت نشد" });
    if (notif.user_id !== user.id && !isOwnerUser(user)) {
      return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }
    
    // Pass user to prevent another check in route
    res.locals.user = user;
    next();
  } catch (err) {
    res.status(400).json({ error: "تأیید مالکیت ناموفق بود" });
  }
};

const notificationSchema = z.object({
  user_id: z.string().min(1),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
  type: z.enum(["system", "forum_reply", "support"]).default("system")
});

router.get("/", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await ensureNotificationTable();

    const { data: listById, error } = await supabase
       .from('notifications')
       .select('*')
       .eq("user_id", user.id)
       .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(listById || []);
  } catch (err) {
    res.status(400).json({ error: "دریافت اعلان‌ها ناموفق بود" });
  }
});

router.post("/", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    const normalizedRole = String(user?.role || "").toLowerCase().trim();
    if (!user || !['owner', 'publisher', 'editor'].includes(normalizedRole)) return res.status(403).json({ error: "فقط مدیر" });

    const parsed = notificationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "ورودی نامعتبر" });
    }
    
    const { user_id, title, message, type } = parsed.data;

    await createUserNotification(user_id, type, title, message);
    res.json({ success: true });
  } catch(e) {
    res.status(400).json({ error: "خطای داخلی" });
  }
});

router.patch("/:id/read", verifyNotificationOwnership, async (req, res) => {
  try {
    const user = res.locals.user;

    await supabase
      .from('notifications')
      .update({ is_read: 1 })
      .eq('id', req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "علامت‌گذاری به‌عنوان خوانده‌شده ناموفق بود" });
  }
});

router.delete("/:id", verifyNotificationOwnership, async (req, res) => {
  try {
    const user = res.locals.user;

    await supabase
      .from('notifications')
      .delete()
      .eq('id', req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "عملیات ناموفق بود" });
  }
});

export default router;
