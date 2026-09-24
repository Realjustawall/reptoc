import crypto from "crypto";
import webpush from "web-push";
import { db, supabase } from "../postgres";
import { decrypt, encrypt } from "./encryption";

type VapidKeys = { publicKey: string; privateKey: string };
let keyPromise: Promise<VapidKeys> | null = null;

async function loadVapidKeys(): Promise<VapidKeys> {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  if (publicKey && privateKey) return { publicKey, privateKey };
  const existing = await db.query("SELECT setting_value FROM settings WHERE setting_key=$1 LIMIT 1", ["webPushVapidKeys"]);
  const stored = existing.rows[0]?.setting_value;
  if (stored?.publicKey && stored?.encryptedPrivateKey) {
    return { publicKey: String(stored.publicKey), privateKey: decrypt(String(stored.encryptedPrivateKey)) };
  }
  const generated = webpush.generateVAPIDKeys();
  await db.query(
    `INSERT INTO settings(setting_key,setting_value) VALUES($1,$2::jsonb)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value`,
    ["webPushVapidKeys", JSON.stringify({ publicKey: generated.publicKey, encryptedPrivateKey: encrypt(generated.privateKey) })],
  );
  return generated;
}

export async function getWebPushPublicKey(): Promise<string> {
  keyPromise ||= loadVapidKeys();
  return (await keyPromise).publicKey;
}

async function configureWebPush() {
  keyPromise ||= loadVapidKeys();
  const keys = await keyPromise;
  webpush.setVapidDetails(String(process.env.VAPID_SUBJECT || "mailto:admin@reptoc.ir").trim(), keys.publicKey, keys.privateKey);
}

export async function saveWebPushSubscription(userId: string, subscription: any, userAgent = "") {
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();
  let endpointHost = "";
  try { endpointHost = new URL(endpoint).hostname.toLowerCase(); } catch {}
  const trustedPushHost = endpointHost === "fcm.googleapis.com"
    || endpointHost.endsWith(".push.services.mozilla.com")
    || endpointHost === "web.push.apple.com"
    || endpointHost.endsWith(".push.apple.com")
    || endpointHost.endsWith(".notify.windows.com");
  if (!endpoint.startsWith("https://") || !trustedPushHost || !p256dh || !auth || endpoint.length > 4096 || p256dh.length > 512 || auth.length > 512) throw new Error("اشتراک Push معتبر نیست.");
  await db.query(
    `INSERT INTO web_push_subscriptions(id,user_id,endpoint,p256dh,auth,user_agent)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,
       auth=EXCLUDED.auth,user_agent=EXCLUDED.user_agent,updated_at=timezone('utc'::text,now()),failure_count=0`,
    [`push-${crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 40)}`, userId, endpoint, p256dh, auth, userAgent.slice(0, 500)],
  );
}

export async function removeWebPushSubscription(userId: string, endpoint?: string) {
  if (endpoint) await db.query("DELETE FROM web_push_subscriptions WHERE user_id=$1 AND endpoint=$2", [userId, endpoint]);
  else await db.query("DELETE FROM web_push_subscriptions WHERE user_id=$1", [userId]);
}

export async function hasWebPushSubscription(userId: string): Promise<boolean> {
  return !!(await db.query("SELECT 1 FROM web_push_subscriptions WHERE user_id=$1 LIMIT 1", [userId])).rowCount;
}

const PUSH_TYPES = new Set(["chapter_published", "forum_reply", "comment_reply", "challenge_winner", "challenge_result"]);

export async function sendWebPushNotification(userId: string, payload: { type: string; title: string; text: string; link?: string }) {
  if (!PUSH_TYPES.has(payload.type) && !payload.type.includes("reply")) return 0;
  await configureWebPush();
  const rows = (await db.query("SELECT id,endpoint,p256dh,auth FROM web_push_subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 10", [userId])).rows;
  let delivered = 0;
  const body = JSON.stringify({ type: payload.type, title: payload.title, body: payload.text, url: payload.link || "/notifications", icon: "/logo-128.webp", tag: `${payload.type}:${payload.link || payload.title}`.slice(0, 180) });
  await Promise.all(rows.map(async (row: any) => {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, { TTL: 86400, urgency: "normal" });
      delivered += 1;
      await supabase.from("web_push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", row.id);
    } catch (error: any) {
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) await supabase.from("web_push_subscriptions").delete().eq("id", row.id);
      else await db.query("UPDATE web_push_subscriptions SET failure_count=failure_count+1 WHERE id=$1", [row.id]).catch(() => {});
    }
  }));
  return delivered;
}
