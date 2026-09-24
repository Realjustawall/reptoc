import express from "express";
import { v4 as uuid } from "uuid";
import { db } from "../../postgres";
import { enforceAdmin } from "../../utils/auth";
import { applyPremiumAction, applyPremiumActions, getEffectiveEntitlements, PREMIUM_TYPES } from "../../utils/premiumEntitlements";

const router = express.Router(); router.use(enforceAdmin);

// ✅ SECURITY: User ID validation pattern (shared across all premiumManagement endpoints).
const VALID_USER_ID = /^(u-[a-f0-9-]{8,80}|admin-master-[a-f0-9-]{8,80}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

router.get("/users/:userId/premium", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!VALID_USER_ID.test(userId)) {
      return res.status(400).json({ error: "شناسه کاربر نامعتبر است." });
    }
    const rows = (await db.query(
      `SELECT id, user_id, premium_type, status, source, starts_at, expires_at, is_permanent, is_paused, auto_renew, payment_subscription_id, granted_by_admin_id, granted_at, revoked_at, internal_note, updated_at
       FROM user_premium_entitlements WHERE user_id=$1 ORDER BY premium_type, created_at DESC`,
      [userId]
    )).rows;
    const payments = (await db.query(
      `SELECT id, premium_type, status, provider, plan_months, paid_at, created_at FROM premium_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    )).rows;
    const audit = (await db.query(
      `SELECT id, user_id, entitlement_id, premium_type, action_type, duration_delta_seconds, previous_expires_at, new_expires_at, performing_admin_id, internal_reason, correlation_id, occurred_at FROM premium_entitlement_audit WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT 250`,
      [userId]
    )).rows;
    res.json({ entitlements: rows, payments, effective: await getEffectiveEntitlements(userId, true), audit });
  } catch (e: any) {
    console.error("premiumManagement error:", e?.message || e);
    res.status(400).json({ error: "عملیات اشتراک ممکن نشد. ورودی‌ها را بررسی کنید یا بعداً تلاش کنید." });
  }
});

router.post("/users/:userId/premium/actions", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!VALID_USER_ID.test(userId)) {
      return res.status(400).json({ error: "شناسه کاربر نامعتبر است." });
    }
    const saved = await applyPremiumAction(userId, res.locals.user.id, req.body);
    res.json({ success: true, entitlement: saved, effective: await getEffectiveEntitlements(userId, true) });
  } catch (e: any) {
    console.error("premiumManagement error:", e?.message || e);
    res.status(400).json({ error: "عملیات اشتراک ممکن نشد. ورودی‌ها را بررسی کنید یا بعداً تلاش کنید." });
  }
});

router.post("/users/:userId/premium/grant-both", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!VALID_USER_ID.test(userId)) {
      return res.status(400).json({ error: "شناسه کاربر نامعتبر است." });
    }
    const correlationId = req.body.correlationId || uuid();
    const shared = req.body.sameTerms || {};
    const [reader, writer] = await applyPremiumActions(userId, res.locals.user.id, [
      { ...shared, ...req.body.reader, premiumType: "reader", action: "grant", correlationId },
      { ...shared, ...req.body.writer, premiumType: "writer", action: "grant", correlationId },
    ]);
    res.json({ success: true, reader, writer });
  } catch (e: any) {
    console.error("premiumManagement error:", e?.message || e);
    res.status(400).json({ error: "عملیات اشتراک ممکن نشد. ورودی‌ها را بررسی کنید یا بعداً تلاش کنید." });
  }
});

router.post("/premium/bulk/preview", async (req, res) => {
  const rawIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];
  if (rawIds.length > 500) return res.status(400).json({ error: "حداکثر ۵۰۰ کاربر" });

  // ✅ SECURITY: Validate every user ID before passing to ANY($1).
  const ids = rawIds
    .filter((id: unknown): id is string => typeof id === "string" && id.length <= 100 && VALID_USER_ID.test(id))
    .slice(0, 500);

  const users = ids.length
    ? (await db.query(`SELECT id, username, email FROM users WHERE id=ANY($1)`, [ids])).rows
    : [];
  res.json({ count: users.length, users, action: req.body.action });
});

router.post("/premium/bulk", async (req, res) => {
  try {
    if (req.body.confirm !== true) return res.status(400).json({ error: "اقدام گروهی نیازمند confirm=true است" });
    const rawIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];
    // ✅ SECURITY: Validate every user ID before applying bulk action.
    const ids = [...new Set(rawIds.filter((id: unknown): id is string => typeof id === "string" && VALID_USER_ID.test(id)))].slice(0, 500) as string[];
    const types = (req.body.premiumTypes || []).filter((x: any) => PREMIUM_TYPES.has(x));
    const correlationId = uuid();
    const results: any[] = [];
    for (const userId of ids) for (const premiumType of types) {
      try {
        let entitlementId = req.body.options?.entitlementId;
        if (!entitlementId && !["grant", "activate"].includes(req.body.action)) {
          entitlementId = (await db.query(`SELECT id FROM user_premium_entitlements WHERE user_id=$1 AND premium_type=$2 AND status NOT IN ('revoked','cancelled') ORDER BY is_permanent DESC, expires_at DESC NULLS FIRST, created_at DESC LIMIT 1`, [userId, premiumType])).rows[0]?.id;
          if (!entitlementId) throw new Error("حق اشتراک منطبقی یافت نشد");
        }
        results.push({ userId, premiumType, entitlement: await applyPremiumAction(userId, res.locals.user.id, { ...req.body.options, entitlementId, premiumType, action: req.body.action, correlationId }) });
      } catch (e: any) {
        results.push({ userId, premiumType, error: e.message });
      }
    }
    res.json({ success: true, correlationId, results });
  } catch (e: any) {
    console.error("premiumManagement error:", e?.message || e);
    res.status(400).json({ error: "عملیات اشتراک ممکن نشد. ورودی‌ها را بررسی کنید یا بعداً تلاش کنید." });
  }
});

router.get("/premium/users", async (req, res) => {
  try {
    const q = String(req.query.q || "");
    const reader = req.query.reader, writer = req.query.writer, source = req.query.source;
    const params: any[] = [`%${q}%`];
    let having = "";
    if (reader === 'active') having += ` AND bool_or(e.premium_type='reader' AND e.status='active' AND NOT e.is_paused AND e.revoked_at IS NULL AND e.starts_at<=now() AND (e.is_permanent OR e.expires_at>now()))`;
    if (writer === 'active') having += ` AND bool_or(e.premium_type='writer' AND e.status='active' AND NOT e.is_paused AND e.revoked_at IS NULL AND e.starts_at<=now() AND (e.is_permanent OR e.expires_at>now()))`;
    const sourceWhere = source ? (params.push(source), ` AND e.source=$${params.length}`) : "";
    const rows = (await db.query(`SELECT u.id, u.username, u.email, json_agg(e.*) FILTER(WHERE e.id IS NOT NULL) entitlements FROM users u LEFT JOIN user_premium_entitlements e ON e.user_id=u.id${sourceWhere} WHERE ($1='%%' OR u.id ILIKE $1 OR u.username ILIKE $1 OR u.email ILIKE $1) GROUP BY u.id HAVING true${having} ORDER BY u.username LIMIT 200`, params)).rows;
    res.json({ users: rows });
  } catch (e: any) {
    console.error("premiumManagement error:", e?.message || e);
    res.status(400).json({ error: "عملیات اشتراک ممکن نشد. ورودی‌ها را بررسی کنید یا بعداً تلاش کنید." });
  }
});

export default router;
