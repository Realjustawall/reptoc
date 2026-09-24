import express from "express";
import crypto from "crypto";
import { supabase } from "../postgres";
import { decrypt } from "./encryption";
import { getEffectiveEntitlements } from "./premiumEntitlements";

/**
 * Session identifiers are stored only as SHA-256 hashes. The raw token lives
 * exclusively inside the encrypted cookie/Bearer payload, so a database leak
 * cannot be replayed against the API.
 */
export function hashSessionToken(raw: unknown): string {
  return crypto.createHash("sha256").update(String(raw ?? "")).digest("hex");
}

function timingSafeEqualString(a: unknown, b: unknown): boolean {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * CSRF validation using a hardened Double-Submit Cookie pattern.
 *
 * Three requirements must ALL hold for a request to pass:
 *   1. The X-CSRF-Token header (or body._csrf) is present.
 *   2. The XSRF-TOKEN cookie is present.
 *   3. The header value matches the cookie value (constant-time compare).
 *
 * Additionally, the per-session server-side csrf_token MUST match the header
 * (constant-time compare). This is the strongest variant of the pattern:
 * even if an attacker can inject a cookie (subdomain cookie tossing, XSS
 * in a sandbox), they still cannot forge the per-session server-side token.
 *
 * Previously this function only verified existence of the cookie, which is
 * insufficient — a cookie-tossing attack on a subdomain could satisfy the
 * "exists" check while supplying an attacker-chosen header value.
 */
export async function validateCSRF(
  req: express.Request,
  session: any
): Promise<boolean> {
  const csrfToken = req.header("X-CSRF-Token") || req.body?._csrf;
  const csrfCookie = req.cookies && (req.cookies['__Host-XSRF-TOKEN'] || req.cookies['XSRF-TOKEN']);

  if (!csrfToken || !csrfCookie) return false;

  // Header MUST equal cookie (double-submit pattern).
  if (!timingSafeEqualString(csrfToken, csrfCookie)) return false;

  // Header MUST equal server-side per-session token.
  if (!timingSafeEqualString(session.csrf_token, csrfToken)) return false;

  return true;
}

function extractSessionId(req: express.Request): string | null {
  const fromCookie = req.cookies?.sessionId || req.cookies?.session_token;
  if (fromCookie) {
    const dec = decrypt(fromCookie);
    if (dec) return dec;
  }

  const authHeader = req.header("Authorization") || req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const dec = decrypt(token);
    if (dec) return dec;
  }

  return null;
}

export async function getActiveUser(
  req: express.Request,
  requireCsrfParam = false
): Promise<any | null> {
  // Force CSRF on every state-changing method, regardless of caller's preference.
  const methodRequiresCsrf = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
  const requireCsrf = methodRequiresCsrf || requireCsrfParam;

  let sessionId = extractSessionId(req);

  if (!sessionId) return null;

  let query = supabase
    .from("sessions")
    .select("*")
    .eq("id", hashSessionToken(sessionId))
    .limit(1);

  const { data: sessions, error: sessionError } = await query;
  const session = Array.isArray(sessions) ? sessions[0] : sessions;

  if (sessionError || !session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    return null;
  }

  if (requireCsrf) {
    const isValid = await validateCSRF(req, session);
    if (!isValid) return null;
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("id", session.user_id)
    .single();

  if (userError || !user) return null;
  if (user.blocked === true || user.blocked === 1) return null;
  user.role = String(user.role || "writer").toLowerCase().trim();

  // Backward-compatible projection: the historical flag means Reader Premium only.
  // Database failure is fail-closed and NEVER grants either entitlement.
  try {
    const effective = await getEffectiveEntitlements(user.id, true);
    user.is_premium = effective.reader;
    user.has_reader_premium = effective.reader;
    user.has_writer_premium = effective.writer;
  } catch {
    // Fail-closed: a database lookup failure must NEVER silently grant premium.
    user.is_premium = false;
    user.has_reader_premium = false;
    user.has_writer_premium = false;
  }

  try {
    const { data: permissionRow } = await supabase
      .from("user_permissions")
      .select("permissions, role_id")
      .eq("user_id", user.id)
      .single();
    const directPermissions = parsePermissions(permissionRow?.permissions);
    let rolePermissions: string[] = [];
    if (permissionRow?.role_id) {
      const { data: customRole } = await supabase
        .from("custom_roles")
        .select("permissions")
        .eq("id", permissionRow.role_id)
        .single();
      rolePermissions = parsePermissions(customRole?.permissions);
    }
    user.custom_permissions = [...new Set([...rolePermissions, ...directPermissions])];
    user.custom_role_id = permissionRow?.role_id || user.custom_role_id || null;
  } catch {
    user.custom_permissions = [];
  }

  return user;
}

export async function enforceAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const requireCsrf = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
  const user = await getActiveUser(req, requireCsrf);
  if (!user || !hasPermission(user, PERMISSIONS.ADMIN)) {
    return res.status(403).json({ error: "Access Denied: High clearance required." });
  }
  res.locals.user = user;
  next();
}

export async function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = await getActiveUser(req, false);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.locals.user = user;
  next();
}

export async function requireUserWithCsrf(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = await getActiveUser(req, true);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.locals.user = user;
  next();
}

export async function isEmailVerificationRequiredForWriting(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("settings")
      .select("setting_value")
      .eq("setting_key", "systemSettings")
      .single();
    if (!data?.setting_value) return false;
    const settings = typeof data.setting_value === "string" ? JSON.parse(data.setting_value) : data.setting_value;
    if (!settings?.emailVerification?.enabled) return false;

    // A requirement nobody can satisfy (no mail provider configured) would
    // lock every unverified account out of writing forever — disable it.
    try {
      const { getEmailProviderAvailability } = await import("./email");
      if (!getEmailProviderAvailability(settings.emailVerification || {}).any) return false;
    } catch {
      return true; // fail-closed when the availability check itself breaks
    }
    return true;
  } catch {
    return false;
  }
}

export async function requireVerifiedEmailForWriting(user: any): Promise<string | null> {
  const required = await isEmailVerificationRequiredForWriting();
  if (!required) return null;
  if (!user?.email) return "An email address is required before writing.";
  if (!user.email_verified) return "Please verify your email address before writing.";
  return null;
}

export const PERMISSIONS = {
  ADMIN: 'admin:*',
  MODERATE: 'moderate:*',
  REPORT_MODERATE: 'report:moderate',
  REPORT_PUNISH: 'report:punish',
  FORUM_PIN: 'forum:pin',
  FORUM_DELETE: 'forum:delete',
  FORUM_EDIT: 'forum:edit',
  FORUM_MODERATE: 'forum:moderate',
  FORUM_ANNOUNCE: 'forum:announce',
  NOVEL_APPROVE: 'novel:approve',
  NOVEL_DELETE: 'novel:delete',
  NOVEL_EDIT_ALL: 'novel:edit_all',
  USER_BAN: 'user:ban',
  USER_DELETE: 'user:delete',
  USER_PROMOTE: 'user:promote',
  TICKET_READ_ALL: 'ticket:read_all',
  TICKET_UPDATE: 'ticket:update',
  TICKET_CLOSE: 'ticket:close',
};

const rolePermissions: Record<string, string[]> = {
  owner: [
    PERMISSIONS.ADMIN,
    PERMISSIONS.FORUM_PIN,
    PERMISSIONS.FORUM_DELETE,
    PERMISSIONS.FORUM_MODERATE,
    PERMISSIONS.NOVEL_APPROVE,
    PERMISSIONS.NOVEL_DELETE,
    PERMISSIONS.NOVEL_EDIT_ALL,
    PERMISSIONS.USER_BAN,
    PERMISSIONS.USER_DELETE,
    PERMISSIONS.USER_PROMOTE,
    PERMISSIONS.TICKET_READ_ALL,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_CLOSE,
  ],
  publisher: [
    PERMISSIONS.FORUM_PIN,
    PERMISSIONS.FORUM_MODERATE,
    PERMISSIONS.NOVEL_APPROVE,
    PERMISSIONS.TICKET_READ_ALL,
  ],
  editor: [
    PERMISSIONS.FORUM_MODERATE,
    PERMISSIONS.FORUM_EDIT,
    PERMISSIONS.NOVEL_EDIT_ALL,
  ],
  writer: [
    PERMISSIONS.FORUM_EDIT,
  ],
};

function parsePermissions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function isOwnerUser(user: any): boolean {
  return !!user && String(user?.role || "").toLowerCase() === "owner";
}

export function hasPermission(
  user: any,
  permission: string,
  resource?: { ownerId?: string; resourceId?: string }
): boolean {
  if (isOwnerUser(user)) return true;

  const normalizedRole = String(user?.role || "").toLowerCase().trim();
  const userPermissions = rolePermissions[normalizedRole] || [];
  const customPermissions = Array.isArray(user?.custom_permissions) ? user.custom_permissions : [];
  if (customPermissions.includes(PERMISSIONS.ADMIN) || customPermissions.includes(permission)) return true;
  if (customPermissions.some((item: string) => item.endsWith(":*") && permission.startsWith(item.slice(0, -1)))) return true;
  if (userPermissions.includes(permission)) {
    if (resource?.ownerId && !permission.includes('*')) {
      return user.id === resource.ownerId;
    }
    return true;
  }

  return false;
}

export function requirePermissionWithContext(permission: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<any> => {
    const user = res.locals.user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const resourceId = req.params.id || req.params.novelId || req.params.threadId;
    let resource: any = null;

    if (resourceId) {
      if (req.path.includes('/novels/')) {
        const { data } = await supabase
          .from('novels')
          .select('author_id')
          .eq('id', resourceId)
          .single();
        resource = data;
      } else if (req.path.includes('/threads/')) {
        const { data } = await supabase
          .from('forum_threads')
          .select('user_id')
          .eq('id', resourceId)
          .single();
        resource = data;
      }
    }

    const hasPerm = hasPermission(user, permission, {
      ownerId: resource?.author_id || resource?.user_id
    });

    if (!hasPerm) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}

export function requirePermission(permission: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): any => {
    const user = res.locals.user;
    if (!user || !hasPermission(user, permission)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
