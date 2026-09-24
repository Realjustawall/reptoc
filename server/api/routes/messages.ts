import { Router } from "express";
import { supabase } from "../../postgres";
import { getActiveUser } from "../../utils/auth";
import { v4 as uuidv4 } from "uuid";
import sanitizeHtml from "sanitize-html";
import { resolveUsername } from "../../utils/usernames";
import { interactionLimiter } from "../limiters";

const router = Router();

function cleanText(value: unknown, max = 2000) {
  return sanitizeHtml(String(value || ""), { allowedTags: [], allowedAttributes: {} }).trim().slice(0, max);
}

/**
 * Validate that an identifier matches the strict UUID/`u-...` shape used by
 * the application. Reject anything else BEFORE constructing a PostgREST filter
 * string. This prevents filter-injection if ID format ever changes or if an
 * attacker attempts to inject commas / parens via a compromised session cookie.
 *
 * Accepted shapes:
 *   - u-<uuidv4>                     e.g. u-1f3e4d2c-...-...-...
 *   - u-<timestamp>-<digits>          legacy Google OAuth IDs
 *   - <uuidv4>                       (rare)
 */
function isSafeUserId(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^(u-[a-f0-9-]{8,80}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value);
}

router.post("/", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const to = cleanText(req.body.to, 80);
    const subject = cleanText(req.body.subject, 160);
    const snippet = cleanText(req.body.snippet, 5000);
    if (!to || !subject || !snippet) return res.status(400).json({ error: "همه فیلدها الزامی هستند" });

    const recipient = await resolveUsername(to);
    if (!recipient) return res.status(404).json({ error: "گیرنده یافت نشد" });

    // Defense in depth: reject malformed IDs before they reach PostgREST filters.
    if (!isSafeUserId(recipient.id) || !isSafeUserId(user.id)) {
      return res.status(400).json({ error: "شناسه کاربر نامعتبر است." });
    }

    if (recipient.id === user.id) return res.status(400).json({ error: "نمی‌توانید به خودتان پیام دهید" });

    // Use two separate queries instead of an interpolated `or()` filter.
    // PostgREST `or()` with embedded `and(...)` clauses is fragile when IDs
    // contain unexpected characters; two explicit eq() queries are safer.
    const [r1, r2] = await Promise.all([
      supabase
        .from("blocked_users")
        .select("id")
        .eq("blocker_user_id", recipient.id)
        .eq("blocked_user_id", user.id)
        .limit(1),
      supabase
        .from("blocked_users")
        .select("id")
        .eq("blocker_user_id", user.id)
        .eq("blocked_user_id", recipient.id)
        .limit(1),
    ]);
    if ((r1.data?.length || 0) + (r2.data?.length || 0) > 0) {
      return res.status(403).json({ error: "ارسال پیام بین این کاربران مسدود است" });
    }

    const msgId = `msg-${Date.now()}-${uuidv4().substring(0, 5)}`;
    await supabase.from("messages").insert({
      id: msgId,
      recipient_id: recipient.id,
      sender_id: user.id,
      username: recipient.username,
      sender: user.username,
      subject,
      snippet,
      is_read: 0,
      created_at: new Date().toISOString(),
    });

    res.json({ success: true, id: msgId });
  } catch (error) {
    res.status(400).json({ error: "ارسال پیام ناموفق بود" });
  }
});

export default router;
