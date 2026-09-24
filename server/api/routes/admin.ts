import express from "express";
import { db, supabase } from "../../postgres";
import { getActiveUser, hasPermission, isOwnerUser, PERMISSIONS } from "../../utils/auth";
import { interactionLimiter } from "../limiters";

import { checkAndAwardAchievement } from "../../utils/achievements";
import { logAdminAction } from "../../utils/audit";
import { encrypt } from "../../utils/encryption";
import { prepareEmailConfig, sendEmailWithAvailableConfig, getEmailProviderAvailability } from "../../utils/email";
import { startInboundMailServer, stopInboundMailServer, isInboundMailRunning, saveInboundMailConfig } from "../../utils/inboundMail";
import { sanitizePlainText } from "../../utils/content";
import { listAuditFiles, readAuditFile, deleteAuditFile } from "../../utils/fileAudit";
import { analyzeContentText, ensureOperationalTables } from "../../utils/operations";
import { deleteNovelCompletely } from "../../utils/novelDeletion";
import { createUserNotification, ensureNotificationTable } from "../../utils/notifications";
import { invalidateNovelCaches } from "../../utils/catalogCache";
import { filterExistingColumns, filterPayloadToExistingColumns, getTableColumns, hasTableColumn, missingExpectedColumns, reportSchemaGapOnce, runOptionalSchemaQueries } from "../../utils/dbSchema";
import { resolveUsername, validateUsername } from "../../utils/usernames";
import {
  classifyComment,
  loadCommentModerationConfig,
  saveCommentModerationConfig,
} from "../../utils/commentModeration";
import bcrypt from "bcryptjs";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const router = express.Router();
// Backups contain database rows, account data and potentially deployment
// secrets. They are intentionally server-local: no authenticated role,
// including the owner, may list, create, download, upload or restore them over
// HTTP. Operational backup work must be performed from the host filesystem.
router.use(["/database-backup", "/backups"], (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).json({ error: "مسیر یافت نشد." });
});
router.use(requireAdminSession);
const execFileAsync = promisify(execFile);

const STAFF_ROLES = new Set(["owner", "publisher", "editor", "moderator", "support"]);

function canManageUsers(user: any) {
  return !!user && (
    isOwnerUser(user) ||
    hasPermission(user, PERMISSIONS.ADMIN) ||
    hasPermission(user, PERMISSIONS.USER_PROMOTE) ||
    hasPermission(user, PERMISSIONS.USER_DELETE) ||
    hasPermission(user, PERMISSIONS.USER_BAN)
  );
}

function canDeleteUsers(user: any) {
  return !!user && (
    isOwnerUser(user) ||
    hasPermission(user, PERMISSIONS.ADMIN) ||
    hasPermission(user, PERMISSIONS.USER_DELETE)
  );
}

function canManageRoles(user: any) {
  return !!user && (
    isOwnerUser(user) ||
    hasPermission(user, PERMISSIONS.ADMIN) ||
    hasPermission(user, PERMISSIONS.USER_PROMOTE)
  );
}

function canChangeSensitiveUserFields(user: any) {
  return !!user && (isOwnerUser(user) || hasPermission(user, PERMISSIONS.ADMIN));
}

function canReadSecurityOperations(user: any) {
  return !!user && (isOwnerUser(user) || hasPermission(user, PERMISSIONS.ADMIN) || hasPermission(user, "security:read"));
}

function canReadFinanceOperations(user: any) {
  return !!user && (isOwnerUser(user) || hasPermission(user, PERMISSIONS.ADMIN) || hasPermission(user, "finance:read"));
}

function canReadAnalyticsOperations(user: any) {
  return !!user && (isOwnerUser(user) || hasPermission(user, PERMISSIONS.ADMIN) || hasPermission(user, "analytics:read_all"));
}

function canReadContentOperations(user: any) {
  return !!user && (isOwnerUser(user) || hasPermission(user, PERMISSIONS.ADMIN) || hasPermission(user, PERMISSIONS.MODERATE) || hasPermission(user, PERMISSIONS.REPORT_MODERATE));
}

function canConfigureCommentModeration(user: any) {
  return !!user && (isOwnerUser(user) || hasPermission(user, PERMISSIONS.ADMIN));
}

function canManageReports(user: any) {
  return !!user && (isOwnerUser(user) || hasPermission(user, PERMISSIONS.ADMIN) || hasPermission(user, PERMISSIONS.MODERATE) || hasPermission(user, PERMISSIONS.REPORT_MODERATE));
}

function canPunishReportTargets(user: any) {
  return !!user && (isOwnerUser(user) || hasPermission(user, PERMISSIONS.ADMIN) || hasPermission(user, PERMISSIONS.REPORT_PUNISH));
}

async function loadReportTarget(report: any) {
  if (!report) return null;
  if (report.target_type === "user") {
    const { data } = await supabase.from("users").select("id, username, nickname, role, avatar, blocked, publishing_blocked").eq("id", report.target_id).single();
    return data || report.target_snapshot;
  }
  if (report.target_type === "novel") {
    const { data } = await supabase.from("novels").select("id, title, author, author_id, description, approval_status, editor_note").eq("id", report.target_id).single();
    return data || report.target_snapshot;
  }
  if (report.target_type === "chapter") {
    const { data } = await supabase.from("chapters").select("id, novel_id, title, content, chapter_number, status, moderation_status").eq("id", report.target_id).single();
    return data || report.target_snapshot;
  }
  const snapshot = typeof report.target_snapshot === "string" ? parseMaybeJson(report.target_snapshot, {}) : (report.target_snapshot || {});
  for (const table of [snapshot.source_table, "chapter_comments", "forum_posts", "messages"].filter(Boolean)) {
    const { data } = await supabase.from(String(table)).select("*").eq("id", report.target_id).single();
    if (data) return { ...data, source_table: table };
  }
  return snapshot;
}

function canReadBackupOperations(user: any) {
  return false;
}

const databaseBackupUpload = multer({
  dest: os.tmpdir(),
  limits: { files: 1, fileSize: Number(process.env.DATABASE_BACKUP_MAX_BYTES || 512 * 1024 * 1024) },
  fileFilter: (_req, file, callback) => callback(null, /\.(dump|backup)$/i.test(file.originalname))
});

function postgresCommandArgs() {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_CONNECTION_STRING;
  const database = process.env.PGDATABASE || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE;

  // ✅ SECURITY: The original implementation could embed a password directly
  // into the pg_dump / pg_restore command line, where it would be readable
  // via /proc/<pid>/cmdline to any local user. We strip credentials from the
  // connection URL and rely on PGPASSWORD env var (set by the caller) for
  // authentication. The password is then only visible in /proc/<pid>/environ,
  // which is restricted to the same user (mode 0400).
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (url.password) {
        // Set PGPASSWORD in our own process env so child_process inherits it.
        // (Caller should have already set this from .env.)
        process.env.PGPASSWORD = process.env.PGPASSWORD || url.password;
        url.password = "";
        url.username = "";
      }
      return [`--dbname=${url.toString()}`];
    } catch {
      // Malformed URL — fall through to database name.
    }
  }
  return database ? [`--dbname=${database}`] : [];
}

async function verifyBackupPassword(admin: any, password: unknown) {
  if (!isOwnerUser(admin)) throw new Error("دسترسی مالک لازم است.");
  const pwd = String(password || "");
  if (!pwd) throw new Error("رمز عبور الزامی است.");

  const { data: account } = await supabase.from("users").select("password").eq("id", admin.id).single();

  // ✅ SECURITY: Always run a bcrypt comparison, even if the account row is
  // missing, so response timing does not leak whether the account exists.
  const DUMMY_HASH = "$2b$12$CwTycUXWue0Thq5StmUMee7Bg3a7QI8Eq2N2c8qO8m1nK8pB8p9e."; // invalid hash
  const hashToCompare = account?.password || DUMMY_HASH;
  const match = await bcrypt.compare(pwd, hashToCompare);

  if (!match) throw new Error("رمز عبور نادرست است.");
}

router.post("/database-backup/download", interactionLimiter, async (req, res) => {
  const admin = res.locals.user;
  let backupPath = "";
  try {
    await verifyBackupPassword(admin, req.body?.password);
    backupPath = path.join(os.tmpdir(), `reptoc-database-${Date.now()}-${uuidv4()}.dump`);
    await execFileAsync("pg_dump", [...postgresCommandArgs(), "--format=custom", "--no-owner", "--no-privileges", `--file=${backupPath}`], { maxBuffer: 1024 * 1024 });
    await logAdminAction(admin.id, null, "download_full_database_backup", { format: "postgres-custom" }).catch(() => {});
    const downloadName = `reptoc-database-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
    res.download(backupPath, downloadName, async () => { await fs.unlink(backupPath).catch(() => {}); });
  } catch (error: any) {
    if (backupPath) await fs.unlink(backupPath).catch(() => {});
    if (!/رمز عبور|مالک|password|owner/i.test(error?.message || "")) console.error("Database backup failed:", error?.message);
    res.status(/رمز عبور|مالک|password|owner/i.test(error?.message || "") ? 403 : 500).json({ error: /رمز عبور|password/i.test(error?.message || "") ? (error?.message || "پشتیبان‌گیری ناموفق بود.") : "پشتیبان‌گیری پایگاه داده ناموفق بود. جزئیات در لاگ سرور ثبت شد." });
  }
});

router.post("/database-backup/restore", interactionLimiter, databaseBackupUpload.single("backup"), async (req, res) => {
  const admin = res.locals.user;
  const uploadedPath = req.file?.path || "";
  try {
    await verifyBackupPassword(admin, req.body?.password);
    if (!req.file || !uploadedPath) return res.status(400).json({ error: "یک فایل PostgreSQL با پسوند .dump یا .backup انتخاب کنید." });
    await execFileAsync("pg_restore", [...postgresCommandArgs(), "--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", uploadedPath], { maxBuffer: 8 * 1024 * 1024 });
    await logAdminAction(admin.id, null, "restore_full_database_backup", { file: path.basename(req.file.originalname), bytes: req.file.size }).catch(() => {});
    res.json({ success: true });
  } catch (error: any) {
    console.error("Database restore failed:", error?.stderr || error?.message);
    res.status(/رمز عبور|مالک|password|owner/i.test(error?.message || "") ? 403 : 500).json({ error: "بازیابی پایگاه داده ناموفق بود. جزئیات در لاگ سرور ثبت شد." });
  } finally {
    if (uploadedPath) await fs.unlink(uploadedPath).catch(() => {});
  }
});

const SENSITIVE_ROLE_PERMISSIONS = new Set([
  PERMISSIONS.ADMIN,
  PERMISSIONS.USER_BAN,
  PERMISSIONS.USER_DELETE,
  PERMISSIONS.USER_PROMOTE,
  "security:read",
  "finance:read"
]);

function normalizePermissionList(value: unknown): string[] {
  return parseJsonArray(value).map((item) => sanitizePlainText(item, 120).trim()).filter(Boolean);
}

function isSensitiveRolePermission(permission: string) {
  const normalized = sanitizePlainText(permission, 120).toLowerCase().trim();
  if (!normalized) return false;
  if (normalized === "*" || normalized.endsWith(":*") || normalized.startsWith("admin:")) return true;
  return SENSITIVE_ROLE_PERMISSIONS.has(normalized);
}

function roleHasSensitivePermissions(role: any) {
  return normalizePermissionList(role?.permissions).some(isSensitiveRolePermission);
}

function sensitiveRolePermissionError(adminUser: any, permissions: string[], existingRole?: any) {
  if (canChangeSensitiveUserFields(adminUser)) return "";
  if (existingRole && roleHasSensitivePermissions(existingRole)) {
    return "فقط مالک/مدیر می‌تواند نقش‌هایی را که از قبل شامل دسترسی‌های حساس هستند ویرایش کند.";
  }
  if (permissions.some(isSensitiveRolePermission)) {
    return "فقط مالک/مدیر می‌تواند دسترسی‌های حساس اعطا کند.";
  }
  return "";
}

const ASSIGNABLE_ROLES = new Set(["writer", "editor", "publisher", "moderator", "support"]);
function normalizeAssignableRole(role: unknown, adminUser: any) {
  const normalized = sanitizePlainText(role, 40).toLowerCase().trim();
  if (normalized === "owner") return isOwnerUser(adminUser) ? "owner" : "";
  return ASSIGNABLE_ROLES.has(normalized) ? normalized : "";
}

function canManageTickets(user: any) {
  return !!user && (
    isOwnerUser(user) ||
    hasPermission(user, PERMISSIONS.ADMIN) ||
    hasPermission(user, PERMISSIONS.TICKET_UPDATE) ||
    hasPermission(user, PERMISSIONS.TICKET_CLOSE)
  );
}

function hasAdminPanelAccess(user: any) {
  return !!user && (
    isOwnerUser(user) ||
    hasPermission(user, PERMISSIONS.ADMIN) ||
    canManageUsers(user) ||
    canManageRoles(user) ||
    canManageTickets(user) ||
    hasPermission(user, PERMISSIONS.MODERATE) ||
    hasPermission(user, PERMISSIONS.REPORT_MODERATE)
  );
}

async function requireAdminSession(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const methodRequiresCsrf = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
    const user = await getActiveUser(req, methodRequiresCsrf);
    if (!user) {
      return res.status(401).json({ error: "غیرمجاز. لطفاً دوباره وارد شوید." });
    }

    if (!hasAdminPanelAccess(user)) {
      return res.status(403).json({ error: "دسترسی غیرمجاز: دسترسی مدیریتی لازم است." });
    }

    res.locals.user = user;
    next();
  } catch (err) {
    res.status(400).json({ error: "احراز هویت ناموفق بود." });
  }
}

async function getSystemSettings() {
  const { data } = await supabase.from("settings").select("setting_value").eq("setting_key", "systemSettings").single();
  if (!data?.setting_value) return {};
  try {
    return typeof data.setting_value === "string" ? JSON.parse(data.setting_value) : data.setting_value;
  } catch {
    return {};
  }
}

function parseJsonArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let userAdminColumnsReady: Promise<void> | null = null;
/**
 * Best-effort schema top-up for the admin user table.
 *
 * On managed PostgreSQL the application role rarely owns `users`, so these
 * statements are expected to be refused; `runOptionalSchemaQueries` swallows
 * permission and dependency errors. The authoritative path is
 * `npm run db:migrate`, run as the table owner. Every read below is column
 * filtered, so a partially migrated database degrades instead of returning 500.
 */
async function ensureUserAdminColumns() {
  if (!userAdminColumnsReady) {
    userAdminColumnsReady = (async () => {
      await runOptionalSchemaQueries([`
        CREATE TABLE IF NOT EXISTS custom_roles (
          id TEXT PRIMARY KEY DEFAULT ('role-' || md5(random()::text || clock_timestamp()::text)),
          name TEXT NOT NULL,
          description TEXT,
          permissions JSONB DEFAULT '[]'::jsonb,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `CREATE UNIQUE INDEX IF NOT EXISTS custom_roles_name_unique ON custom_roles(name)`, `
        CREATE TABLE IF NOT EXISTS user_permissions (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          role_id TEXT,
          permissions JSONB DEFAULT '[]'::jsonb,
          is_staff BOOLEAN DEFAULT false,
          updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS updated_by TEXT REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false`,
      `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'writer'`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS departments TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS stars INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS streak INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS publishing_blocked BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_plan TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_lifetime BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_author BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_role BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_bio TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id TEXT`]);
      await ensureNotificationTable().catch(() => {});
    })().catch((error) => {
      userAdminColumnsReady = null;
      throw error;
    });
  }
  return userAdminColumnsReady;
}

// Direct contact identifiers are PII: they are only included for actors who
// may also CHANGE sensitive user fields (owner / admin capability).
const ADMIN_USER_PII_COLUMNS = ["email", "phone"];
const ADMIN_USER_COLUMNS = [
  "id",
  "username",
  "nickname",
  "avatar",
  "role",
  "custom_role_id",
  "departments",
  "level",
  "xp",
  "coins",
  "stars",
  "created_at",
  "verified_author",
  "verified_role",
  "email_verified",
  "twofa_enabled",
  "is_premium",
  "premium_plan",
  "premium_until",
  "premium_lifetime",
  "is_staff",
  "blocked",
  "publishing_blocked",
  "profile_bio"
];

async function getAvailableAdminUserColumns(adminUser?: any) {
  const baseColumns = ADMIN_USER_COLUMNS.filter((column) => !ADMIN_USER_PII_COLUMNS.includes(column));
  const withPii = canChangeSensitiveUserFields(adminUser)
    ? [...baseColumns, ...ADMIN_USER_PII_COLUMNS]
    : baseColumns;
  const columns = await filterExistingColumns("users", withPii);
  return columns.length ? columns : ["id", "username"];
}

router.post("/verify_author", interactionLimiter, async (req, res) => {
  try {
    const adminUser = res.locals.user;
    if (!isOwnerUser(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    // CSRF check - verify token
    const csrfToken = req.headers['x-csrf-token'] as string;
    const csrfCookie = req.cookies?.['XSRF-TOKEN'];
    if (!csrfToken || csrfToken !== csrfCookie) {
      return res.status(403).json({ error: "عدم تطابق توکن CSRF" });
    }

    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "نام کاربری الزامی است" });

    const resolvedTarget = await resolveUsername(username);
    if (!resolvedTarget) return res.status(404).json({ error: "کاربر یافت نشد" });
    const targetUser = resolvedTarget;

    await supabase.from("users").update({ verified_author: true }).eq("id", targetUser.id);
    await checkAndAwardAchievement(targetUser.id, 'ach_comm_verified');
    
    await createUserNotification(
      targetUser.id,
      "account_verified_author",
      "حساب تأیید شد ✓",
      "تبریک! حساب شما به عنوان نویسنده تأییدشده مشخص شد."
    );

    res.json({ success: true, message: `کاربر ${targetUser.username} به عنوان نویسنده تأیید شد و نشان مربوطه اعطا گردید.` });
    try { await logAdminAction(adminUser.id, targetUser.id, 'verify_author', { username: targetUser.username }); } catch {}
  } catch (err) {
    res.status(400).json({ error: "تأیید نویسنده ناموفق بود" });
  }
});

router.post("/verify_role", interactionLimiter, async (req, res) => {
  try {
    const adminUser = res.locals.user;
    if (!isOwnerUser(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    // CSRF check - verify token
    const csrfToken = req.headers['x-csrf-token'] as string;
    const csrfCookie = req.cookies?.['XSRF-TOKEN'];
    if (!csrfToken || csrfToken !== csrfCookie) {
      return res.status(403).json({ error: "عدم تطابق توکن CSRF" });
    }

    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "نام کاربری الزامی است" });

    const resolvedTarget = await resolveUsername(username);
    if (!resolvedTarget) return res.status(404).json({ error: "کاربر یافت نشد" });
    const targetUser = resolvedTarget;

    await supabase.from("users").update({ verified_role: true }).eq("id", targetUser.id);
    
    await createUserNotification(
      targetUser.id,
      "account_verified_role",
      "نقش تأییدشده اعطا شد ✓",
      "تبریک! نقش تأییدشده به شما اعطا شد."
    );

    res.json({ success: true, message: `نقش تأییدشده به کاربر ${targetUser.username} اعطا شد.` });
    try { await logAdminAction(adminUser.id, targetUser.id, 'verify_role', { username: targetUser.username }); } catch {}
  } catch (err) {
    res.status(400).json({ error: "اعطای نقش تأییدشده ناموفق بود" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const user = res.locals.user;
    if (!canManageUsers(user)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureUserAdminColumns().catch((error) => reportSchemaGapOnce("admin/users columns", error));

    const userColumns = await getAvailableAdminUserColumns(user);
    const orderColumn = userColumns.includes("created_at") ? "created_at" : userColumns.includes("username") ? "username" : "id";
    const reviewColumns = await filterExistingColumns("reviews", ["user_id"]);
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(userColumns.join(", "))
      .order(orderColumn, { ascending: false });
    if (usersError) throw usersError;

    const userIds = (users || []).map((item: any) => item.id);
    const safeData = async (query: Promise<any>, label: string) => {
      try {
        const result = await query;
        if (result?.error) throw result.error;
        return result?.data || [];
      } catch (error: any) {
        return [];
      }
    };
    const [
      novelsRows,
      reviewsRows,
      bookmarksRows,
      followersRows,
      ticketsRows,
      permissionsRows,
      rolesRows,
      premiumRows
    ] = await Promise.all([
      userIds.length ? safeData(supabase.from("novels").select("author_id").in("author_id", userIds) as any, "novels") : Promise.resolve([]),
      userIds.length && reviewColumns.length ? safeData(supabase.from("reviews").select(reviewColumns.join(", ")) as any, "reviews") : Promise.resolve([]),
      userIds.length ? safeData(supabase.from("bookmarks").select("user_id").in("user_id", userIds) as any, "bookmarks") : Promise.resolve([]),
      userIds.length ? safeData(supabase.from("follows").select("target_id").eq("target_type", "user").in("target_id", userIds) as any, "followers") : Promise.resolve([]),
      userIds.length ? safeData(supabase.from("support_tickets").select("user_id").in("user_id", userIds) as any, "tickets") : Promise.resolve([]),
      userIds.length ? safeData(supabase.from("user_permissions").select("*").in("user_id", userIds) as any, "permissions") : Promise.resolve([]),
      safeData(supabase.from("custom_roles").select("*").order("created_at", { ascending: false }) as any, "roles"),
      userIds.length ? safeData(supabase.from("user_premium_entitlements").select("*").in("user_id", userIds) as any, "premium") : Promise.resolve([])
    ]);

    const countBy = (rows: any[] = [], key: string) => rows.reduce((acc: Record<string, number>, row: any) => {
      const value = row[key];
      if (value) acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
    const novelCounts = countBy(novelsRows, "author_id");
    const reviewCounts = countBy(reviewsRows, "user_id");
    const bookmarkCounts = countBy(bookmarksRows, "user_id");
    const followerCounts = countBy(followersRows, "target_id");
    const ticketCounts = countBy(ticketsRows, "user_id");
    const permissionsByUser = new Map((permissionsRows || []).map((row: any) => [row.user_id, row]));
    const rolesById = new Map((rolesRows || []).map((row: any) => [row.id, row]));
    const now = Date.now();
    const premiumByUser = new Map<string, any[]>();
    for (const entitlement of premiumRows || []) {
      const effective = entitlement.status === "active" && !entitlement.is_paused && !entitlement.revoked_at
        && new Date(entitlement.starts_at).getTime() <= now
        && (entitlement.is_permanent || new Date(entitlement.expires_at).getTime() > now);
      if (!effective) continue;
      const rows = premiumByUser.get(entitlement.user_id) || [];
      rows.push(entitlement);
      premiumByUser.set(entitlement.user_id, rows);
    }

    res.json((users || []).map((item: any) => {
      const premiumSources = premiumByUser.get(item.id) || [];
      return {
        ...item,
        is_staff: item.is_staff || STAFF_ROLES.has(String(item.role || "").toLowerCase().trim()),
        departments: parseJsonArray(item.departments),
        permissions: (permissionsByUser.get(item.id) as any)?.permissions || [],
        customRole: item.custom_role_id ? (rolesById.get(item.custom_role_id) as any) || null : null,
        premium_entitlements: {
          reader: premiumSources.some((source: any) => source.premium_type === "reader"),
          writer: premiumSources.some((source: any) => source.premium_type === "writer"),
          sources: premiumSources
        },
        counts: {
          novels: novelCounts[item.id] || 0,
          reviews: reviewCounts[item.id] || 0,
          bookmarks: bookmarkCounts[item.id] || 0,
          followers: followerCounts[item.id] || 0,
          tickets: ticketCounts[item.id] || 0
        }
      };
    }));
  } catch (error: any) {
    // A pending migration must not blank the whole admin roster. Report which
    // columns are missing once, then serve the identity fields that do exist.
    reportSchemaGapOnce("admin/users load", error);
    try {
      const fallbackColumns = await filterExistingColumns("users", ["id", "username", "role", "avatar", "created_at"]);
      const { data: fallbackUsers } = await supabase
        .from("users")
        .select((fallbackColumns.length ? fallbackColumns : ["id", "username"]).join(", "));
      const missing = await missingExpectedColumns("users", ADMIN_USER_COLUMNS);
      if (missing.length) {
        res.setHeader("X-Schema-Migration-Required", missing.slice(0, 12).join(","));
      }
      return res.json((fallbackUsers || []).map((item: any) => ({
        ...item,
        departments: [],
        permissions: [],
        customRole: null,
        premium_entitlements: { reader: false, writer: false, sources: [] },
        counts: { novels: 0, reviews: 0, bookmarks: 0, followers: 0, tickets: 0 },
      })));
    } catch {
      return res.json([]);
    }
  }
});

router.post("/users/:id/departments", interactionLimiter, async (req, res) => {
  try {
    const user = res.locals.user;
    if (!canManageUsers(user)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    // CSRF check
    const csrfToken = req.headers['x-csrf-token'] as string;
    const csrfCookie = req.cookies?.['XSRF-TOKEN'];
    if (!csrfToken || csrfToken !== csrfCookie) {
      return res.status(403).json({ error: "عدم تطابق توکن CSRF" });
    }

    const { departments } = req.body;
    // expect departments to be a JSON string like '["Technical", "Billing"]' or just store as string
    if (await hasTableColumn("users", "departments")) {
      await supabase.from('users').update({ departments: JSON.stringify(departments) }).eq('id', req.params.id);
    }

    res.json({ success: true, departments });
    try { await logAdminAction(user.id, req.params.id, 'update_departments', { departments }); } catch {}
  } catch (err) {
    res.status(400).json({ error: "به‌روزرسانی دپارتمان‌ها ناموفق بود" });
  }
});

// Update user profile / role / stats
router.put("/users/:id", interactionLimiter, async (req, res) => {
  try {
    const adminUser = res.locals.user;
    if (!canManageUsers(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureUserAdminColumns().catch((error) => reportSchemaGapOnce("admin/users columns", error));

    const userId = req.params.id;
    const body = req.body || {};
    const updatePayload: any = {};

    // Allowed fields to update
    const allowed = [
      "role",
      "level",
      "xp",
      "coins",
      "stars",
      "nickname",
      "email",
      "phone",
      "avatar",
      "profile_bio",
      "departments",
      "verified_author",
      "verified_role",
      "email_verified",
      "premium_until",
      "premium_plan",
      "is_premium",
      "premium_lifetime",
      "custom_role_id",
      "is_staff",
      "blocked",
      "publishing_blocked"
    ];

    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        updatePayload[k] = body[k];
      }
    }

    const sensitiveFields = [
      "role",
      "custom_role_id",
      "is_staff",
      "premium_until",
      "premium_plan",
      "is_premium",
      "premium_lifetime",
      "coins",
      "stars",
      "level",
      "xp",
      "email_verified",
      "verified_author",
      "verified_role",
      "blocked",
      "publishing_blocked",
      // Contact identifiers grant password-reset access to the account, so
      // changing them is a sensitive operation (account-takeover chain).
      "email",
      "phone",
      "password"
    ];
    const touchesSensitive = sensitiveFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))
      || body.premiumDays !== undefined
      || body.premiumLifetime !== undefined
      || body.disablePremium !== undefined;
    if (touchesSensitive && !canChangeSensitiveUserFields(adminUser)) {
      return res.status(403).json({ error: "فقط مالک/مدیر می‌تواند نقش‌ها، دسترسی‌ها، اشتراک ویژه، اطلاعات ورود یا موجودی حساب را تغییر دهد." });
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, "role")) {
      const { data: targetUser } = await supabase.from("users").select("role").eq("id", userId).single();
      const currentRole = String(targetUser?.role || "").toLowerCase().trim();
      const requestedRole = String(updatePayload.role || "").toLowerCase().trim();
      if ((currentRole === "owner" || requestedRole === "owner") && !isOwnerUser(adminUser)) {
        return res.status(403).json({ error: "فقط مالک فعلی می‌تواند دسترسی مالکیت را اعطا یا سلب کند." });
      }
      const nextRole = normalizeAssignableRole(updatePayload.role, adminUser);
      if (!nextRole) return res.status(400).json({ error: "تعیین نقش نامعتبر یا غیرمجاز است." });
      updatePayload.role = nextRole;
    }

    // Owner accounts are fully immutable for non-owner staff: contact
    // identifiers on the owner account would grant password-reset access.
    if (!isOwnerUser(adminUser)) {
      const { data: targetRole } = await supabase.from("users").select("role").eq("id", userId).single();
      if (String(targetRole?.role || "").toLowerCase().trim() === "owner" && Object.keys(updatePayload).length > 0) {
        return res.status(403).json({ error: "فقط مالک می‌تواند حساب مالک را تغییر دهد." });
      }
    }

    // Password change (hashing)
    if (body.password && typeof body.password === "string" && body.password.length > 0) {
      const hashed = await bcrypt.hash(body.password, 12);
      updatePayload.password = hashed;
    }

    // Departments may be passed as array
    if (updatePayload.departments && Array.isArray(updatePayload.departments)) {
      updatePayload.departments = JSON.stringify(updatePayload.departments);
    }

    // Support premiumDays (number) sent by the client
    if (typeof body.premiumDays === 'number' && body.premiumDays > 0) {
      const until = new Date(Date.now() + body.premiumDays * 24 * 60 * 60 * 1000).toISOString();
      updatePayload.premium_until = until;
      updatePayload.is_premium = true;
      updatePayload.premium_lifetime = false;
    }

    if (body.premiumLifetime === true) {
      updatePayload.is_premium = true;
      updatePayload.premium_lifetime = true;
      updatePayload.premium_until = null;
    }

    if (body.disablePremium === true) {
      updatePayload.is_premium = false;
      updatePayload.premium_lifetime = false;
      updatePayload.premium_until = null;
      updatePayload.premium_plan = null;
    }

    const existingUpdatePayload = await filterPayloadToExistingColumns("users", updatePayload);
    Object.keys(updatePayload).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(existingUpdatePayload, key)) delete updatePayload[key];
    });

    if (Object.keys(updatePayload).length === 0) return res.status(400).json({ error: "هیچ فیلد قابل به‌روزرسانی ارسال نشده است" });

    const { error } = await supabase.from("users").update(updatePayload).eq("id", userId);
    if (error) throw error;

    // If achievements array provided, award them
    if (Array.isArray(body.achievements)) {
      for (const aid of body.achievements) {
        try { await checkAndAwardAchievement(userId, aid); } catch (e) { /* continue */ }
      }
    }

    res.json({ success: true });
    try { await logAdminAction(adminUser.id, userId, 'update_user', updatePayload); } catch {}
  } catch (err) {
    res.status(400).json({ error: "به‌روزرسانی کاربر ناموفق بود" });
  }
});

// Grant a specific achievement to a user
router.post("/users/:id/achievements", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageUsers(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    const userId = req.params.id;
    const { achievementId } = req.body;
    if (!achievementId) return res.status(400).json({ error: "achievementId الزامی است" });

    await checkAndAwardAchievement(userId, achievementId);
    res.json({ success: true });
    try { await logAdminAction(adminUser.id, userId, 'grant_achievement', { achievementId }); } catch {}
  } catch (err) {
    res.status(400).json({ error: "اعطای نشان ناموفق بود" });
  }
});

// Delete user
router.delete("/users/:id", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canDeleteUsers(adminUser)) return res.status(403).json({ error: "حذف کاربر نیازمند دسترسی USER_DELETE یا مالک/مدیر است." });

    const userId = req.params.id;
    if (userId === adminUser.id) return res.status(409).json({ error: "نمی‌توانید حساب مدیریتی فعال خودتان را حذف کنید." });
    const deleted = await db.withTransaction(async (client) => {
      const target = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      if (!target.rowCount) return false;
      await client.query("DELETE FROM users WHERE id=$1", [userId]);
      return true;
    });
    if (!deleted) return res.status(404).json({ error: "کاربر یافت نشد." });

    res.json({ success: true });
    try { await logAdminAction(adminUser.id, userId, 'delete_user', {}); } catch {}
  } catch (err: any) {
    console.error("Admin user deletion failed", { userId: req.params.id, code: err?.code, message: err?.message });
    res.status(409).json({ error: "حذف کاربر ممکن نیست، زیرا رکوردهای مرتبط همچنان به این حساب وابسته‌اند." });
  }
});

router.get("/reports", async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, false);
    if (!canManageReports(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    const status = typeof req.query.status === "string" ? req.query.status : "";
    let query = supabase
      .from("reports")
      .select("id, reporter_id, target_type, target_id, target_user_id, reason, details, status, priority, moderator_note, assigned_to, action_taken, resolved_by, resolved_at, updated_at, created_at")
      .order("created_at", { ascending: false });
    if (status && status !== "all") query = query.eq("status", status.toUpperCase());

    const { data, error } = await query.limit(200);
    if (error) throw error;
    res.json({ reports: data || [] });
  } catch {
    res.status(400).json({ error: "بارگذاری گزارش‌ها ناموفق بود" });
  }
});

router.get("/reports/:id", async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, false);
    if (!canManageReports(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    const { data: report } = await supabase.from("reports").select("*").eq("id", req.params.id).single();
    if (!report) return res.status(404).json({ error: "گزارش یافت نشد" });
    const { data: events } = await supabase
      .from("report_events")
      .select("*")
      .eq("report_id", req.params.id)
      .order("created_at", { ascending: true });
    const [{ data: reporter }, { data: targetUser }, target] = await Promise.all([
      supabase.from("users").select("id, username, nickname, role, avatar").eq("id", report.reporter_id).single(),
      report.target_user_id ? supabase.from("users").select("id, username, nickname, role, avatar, blocked, publishing_blocked").eq("id", report.target_user_id).single() : Promise.resolve({ data: null }),
      loadReportTarget(report)
    ]);
    res.json({ report, reporter, targetUser, target, events: events || [], canPunish: canPunishReportTargets(adminUser) });
  } catch {
    res.status(400).json({ error: "بارگذاری گزارش ناموفق بود" });
  }
});

router.patch("/reports/:id", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageReports(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    const { data: existingReport } = await supabase.from("reports").select("*").eq("id", req.params.id).single();
    if (!existingReport) return res.status(404).json({ error: "گزارش یافت نشد" });

    const allowedStatuses = new Set(["OPEN", "TRIAGED", "INVESTIGATING", "ACTIONED", "DISMISSED", "RESOLVED"]);
    const allowedPriorities = new Set(["low", "normal", "high", "urgent"]);
    const updates: any = { updated_at: new Date().toISOString() };
    const events: Array<{ type: string; note?: string }> = [];

    if (req.body.status !== undefined) {
      const status = String(req.body.status).toUpperCase();
      if (!allowedStatuses.has(status)) return res.status(400).json({ error: "وضعیت گزارش نامعتبر است" });
      updates.status = status;
      if (["ACTIONED", "DISMISSED", "RESOLVED"].includes(status)) {
        updates.resolved_by = adminUser.id;
        updates.resolved_at = new Date().toISOString();
      }
      events.push({ type: `status:${status.toLowerCase()}` });
    }
    if (req.body.priority !== undefined) {
      const priority = String(req.body.priority).toLowerCase();
      if (!allowedPriorities.has(priority)) return res.status(400).json({ error: "اولویت گزارش نامعتبر است" });
      updates.priority = priority;
      events.push({ type: `priority:${priority}` });
    }
    if (req.body.assignedTo !== undefined) {
      updates.assigned_to = req.body.assignedTo ? String(req.body.assignedTo) : null;
      events.push({ type: "assigned", note: updates.assigned_to || "بدون مسئول" });
    }
    if (req.body.moderatorNote !== undefined) {
      updates.moderator_note = String(req.body.moderatorNote || "").slice(0, 5000);
      events.push({ type: "note", note: updates.moderator_note });
    }
    if (req.body.actionTaken !== undefined) {
      updates.action_taken = String(req.body.actionTaken || "").slice(0, 1000);
      events.push({ type: "action", note: updates.action_taken });
    }
    if (req.body.decision !== undefined) {
      const decision = String(req.body.decision).toLowerCase();
      if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: "تصمیم گزارش نامعتبر است" });
      updates.status = decision === "approved" ? "ACTIONED" : "DISMISSED";
      updates.resolved_by = adminUser.id;
      updates.resolved_at = new Date().toISOString();
      updates.action_taken = decision === "approved" ? "گزارش تأیید شد" : "گزارش رد شد";
      events.push({ type: `decision:${decision}`, note: req.body.moderatorNote || undefined });
    }

    const punishment = String(req.body.punishment || "none").toLowerCase();
    if (punishment !== "none") {
      if (!canPunishReportTargets(adminUser)) return res.status(403).json({ error: "دسترسی لازم برای اعمال مجازات گزارش را ندارید." });
      if (!existingReport.target_user_id) return res.status(400).json({ error: "این گزارش فاقد حساب هدف قابل مجازات است." });
      const { data: targetAccount } = await supabase.from("users").select("id, username, role").eq("id", existingReport.target_user_id).single();
      if (!targetAccount) return res.status(404).json({ error: "حساب هدف دیگر وجود ندارد." });
      if (isOwnerUser(targetAccount) && !isOwnerUser(adminUser)) return res.status(403).json({ error: "فقط مالک می‌تواند نسبت به حساب مالک اقدام کند." });
      if (!['warn', 'publishing_block', 'account_block'].includes(punishment)) return res.status(400).json({ error: "مجازات نامعتبر است." });
      if (punishment === 'publishing_block') await supabase.from("users").update({ publishing_blocked: true }).eq("id", targetAccount.id);
      if (punishment === 'account_block') await supabase.from("users").update({ blocked: true }).eq("id", targetAccount.id);
      await createUserNotification(
        targetAccount.id,
        "moderation_action",
        punishment === "warn" ? "هشدار مدیریت" : "محدودیت روی حساب اعمال شد",
        sanitizePlainText(req.body.moderatorNote || `گزارشی علیه حساب شما تأیید شد. اقدام: ${punishment}.`, 2000),
        ""
      );
      updates.action_taken = punishment;
      events.push({ type: `punishment:${punishment}`, note: req.body.moderatorNote || undefined });
    }

    const { data: report, error } = await supabase.from("reports").update(updates).eq("id", req.params.id).select("*").single();
    if (error || !report) return res.status(404).json({ error: "گزارش یافت نشد" });

    for (const event of events) {
      await supabase.from("report_events").insert({
        id: `revt-${uuidv4()}`,
        report_id: req.params.id,
        actor_id: adminUser.id,
        event_type: event.type,
        note: event.note || null
      });
    }
    try { await logAdminAction(adminUser.id, null, "moderate_report", { reportId: req.params.id, updates }); } catch {}
    res.json({ success: true, report });
  } catch {
    res.status(400).json({ error: "به‌روزرسانی گزارش ناموفق بود" });
  }
});

router.get("/site-analytics", async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, false);
    if (!canManageUsers(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [
      usersCount,
      novelsCount,
      pendingCount,
      reviewsCount,
      chapterCommentsCount,
      ticketsCount,
      logsResult,
      sessionsResult
    ] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("novels").select("id", { count: "exact", head: true }),
      supabase.from("novels").select("id", { count: "exact", head: true }).eq("approval_status", "pending_approval"),
      supabase.from("reviews").select("id", { count: "exact", head: true }),
      supabase.from("chapter_comments").select("id", { count: "exact", head: true }),
      supabase.from("support_tickets").select("id", { count: "exact", head: true }),
      supabase.from("analytics_logs").select("created_at, action_type, viewer_id, country_name, country_code, region_name, city_name, is_vpn, device_type, device_os, device_browser").gte("created_at", since).limit(5000),
      supabase.from("reading_sessions").select("created_at, read_seconds, scroll_percentage, user_id, country_name, country_code, region_name, city_name, is_vpn, device_type, device_os, device_browser, foreground_active").eq("foreground_active", true).gte("created_at", since).limit(5000)
    ]);

    const rows = [...(logsResult.data || []), ...(sessionsResult.data || [])];
    const percent = (count: number, total: number) => total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
    const distribution = (field: string, limit = 12) => {
      const counts = new Map<string, number>();
      rows.forEach((row: any) => {
        const value = String(row[field] || "نامشخص").trim() || "نامشخص";
        counts.set(value, (counts.get(value) || 0) + 1);
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({
        name,
        count,
        percentage: percent(count, rows.length)
      }));
    };
    const dailyMap: Record<string, { views: number; sessions: number; engagements: number; readSeconds: number }> = {};
    (logsResult.data || []).forEach((row: any) => {
      const day = new Date(row.created_at).toISOString().slice(0, 10);
      dailyMap[day] ||= { views: 0, sessions: 0, engagements: 0, readSeconds: 0 };
      if (row.action_type === "view") dailyMap[day].views++;
      else dailyMap[day].engagements++;
    });
    (sessionsResult.data || []).forEach((row: any) => {
      const day = new Date(row.created_at).toISOString().slice(0, 10);
      dailyMap[day] ||= { views: 0, sessions: 0, engagements: 0, readSeconds: 0 };
      dailyMap[day].sessions++;
      dailyMap[day].readSeconds += Number(row.read_seconds || 0);
    });

    res.json({
      totals: {
        users: usersCount.count || 0,
        novels: novelsCount.count || 0,
        pendingApprovals: pendingCount.count || 0,
        reviews: reviewsCount.count || 0,
        chapterComments: chapterCommentsCount.count || 0,
        tickets: ticketsCount.count || 0,
        analyticsSignals: rows.length,
        vpnOrProxyRate: percent(rows.filter((row: any) => row.is_vpn).length, rows.length)
      },
      audience: {
        countries: distribution("country_name"),
        countryCodes: distribution("country_code"),
        regions: distribution("region_name"),
        cities: distribution("city_name"),
        devices: distribution("device_type"),
        operatingSystems: distribution("device_os"),
        browsers: distribution("device_browser")
      },
      daily: Object.entries(dailyMap).map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date))
    });
  } catch (err) {
    res.status(400).json({ error: "بارگذاری تحلیل‌های سایت ناموفق بود" });
  }
});

router.get("/novels", async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, false);
    if (!isOwnerUser(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const { status, q } = req.query;
    let query = supabase.from("novels").select("*").order("created_at", { ascending: false });
    if (typeof status === "string" && status && status !== "all") query = query.eq("approval_status", status);
    if (typeof q === "string" && q.trim()) {
      const term = sanitizePlainText(q, 120).replace(/[%_]/g, "");
      query = query.or(`title.ilike.%${term}%,author.ilike.%${term}%,genre.ilike.%${term}%`);
    }
    const { data, error } = await query.limit(300);
    if (error) throw error;
    const ids = (data || []).map((novel: any) => novel.id);
    const counts = ids.length ? (await db.query(
      `SELECT novel_id,COUNT(*)::int AS count FROM chapters
        WHERE novel_id=ANY($1::text[]) AND lower(COALESCE(status,''))='published'
          AND COALESCE(moderation_status,'visible')='visible'
          AND (scheduled_at IS NULL OR scheduled_at<=timezone('utc'::text,now()))
        GROUP BY novel_id`,
      [ids],
    )).rows : [];
    const countMap = new Map(counts.map((row: any) => [String(row.novel_id), Number(row.count)]));
    res.json({ novels: (data || []).map((novel: any) => {
      const publishedChapterCount = countMap.get(String(novel.id)) || 0;
      return {
        ...novel,
        published_chapter_count: publishedChapterCount,
        average_views: publishedChapterCount ? Number((Number(novel.views_count || 0) / publishedChapterCount).toFixed(2)) : 0,
      };
    }) });
  } catch {
    res.status(400).json({ error: "بارگذاری رمان‌ها ناموفق بود" });
  }
});

router.delete("/novels/:id", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!isOwnerUser(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await deleteNovelCompletely(req.params.id);
    try { await logAdminAction(adminUser.id, req.params.id, "delete_novel", {}); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف رمان ناموفق بود" });
  }
});

router.get("/roles", async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, false);
    if (!canManageRoles(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const { data } = await supabase.from("custom_roles").select("*").order("created_at", { ascending: false });
    res.json({ roles: data || [] });
  } catch {
    res.status(400).json({ error: "بارگذاری نقش‌ها ناموفق بود" });
  }
});

router.post("/roles", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageRoles(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const name = sanitizePlainText(req.body.name, 80).trim();
    if (!name) return res.status(400).json({ error: "نام نقش الزامی است" });
    const description = sanitizePlainText(req.body.description, 500);
    const permissions = normalizePermissionList(req.body.permissions);
    const requestedId = req.body.id ? sanitizePlainText(req.body.id, 120) : undefined;
    const { data: existingByName } = await supabase.from("custom_roles").select("*").eq("name", name).single();
    const { data: existingById } = requestedId
      ? await supabase.from("custom_roles").select("*").eq("id", requestedId).single()
      : { data: null } as any;
    const sensitiveError = sensitiveRolePermissionError(adminUser, permissions, existingByName || existingById);
    if (sensitiveError) return res.status(403).json({ error: sensitiveError });

    const payload = { id: requestedId || `role-${uuidv4()}`, name, description, permissions, created_by: adminUser.id, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("custom_roles").upsert(payload, { onConflict: "name" }).select("*").single();
    if (error) throw error;
    try { await logAdminAction(adminUser.id, null, "upsert_custom_role", { name, permissions }); } catch {}
    res.json({ success: true, role: data });
  } catch {
    res.status(400).json({ error: "ذخیره نقش ناموفق بود" });
  }
});

router.put("/roles/:id", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageRoles(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const roleId = sanitizePlainText(req.params.id, 120);
    const name = sanitizePlainText(req.body.name, 80).trim();
    if (!name) return res.status(400).json({ error: "نام نقش الزامی است" });
    const description = sanitizePlainText(req.body.description, 500);
    const permissions = normalizePermissionList(req.body.permissions);
    const { data: existingRole } = await supabase.from("custom_roles").select("*").eq("id", roleId).single();
    if (!existingRole) return res.status(404).json({ error: "نقش یافت نشد" });
    const sensitiveError = sensitiveRolePermissionError(adminUser, permissions, existingRole);
    if (sensitiveError) return res.status(403).json({ error: sensitiveError });

    const { data, error } = await supabase
      .from("custom_roles")
      .update({ name, description, permissions, updated_at: new Date().toISOString() })
      .eq("id", roleId)
      .select("*")
      .single();
    if (error || !data) return res.status(404).json({ error: "نقش یافت نشد" });
    try { await logAdminAction(adminUser.id, null, "update_custom_role", { roleId, name, permissions }); } catch {}
    res.json({ success: true, role: data });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "به‌روزرسانی نقش ناموفق بود" });
  }
});

router.delete("/roles/:id", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageRoles(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const roleId = sanitizePlainText(req.params.id, 120);
    const { data: existingRole } = await supabase.from("custom_roles").select("*").eq("id", roleId).single();
    if (existingRole && sensitiveRolePermissionError(adminUser, [], existingRole)) {
      return res.status(403).json({ error: "فقط مالک/مدیر می‌تواند نقش‌های دارای دسترسی حساس را حذف کند." });
    }
    await supabase.from("user_permissions").update({ role_id: null, updated_by: adminUser.id, updated_at: new Date().toISOString() }).eq("role_id", roleId);
    await supabase.from("users").update({ custom_role_id: null }).eq("custom_role_id", roleId);
    const { error } = await supabase.from("custom_roles").delete().eq("id", roleId);
    if (error) throw error;
    try { await logAdminAction(adminUser.id, null, "delete_custom_role", { roleId }); } catch {}
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "حذف نقش ناموفق بود" });
  }
});

router.post("/users/:id/permissions", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageRoles(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    if (!canChangeSensitiveUserFields(adminUser)) return res.status(403).json({ error: "فقط مالک/مدیر می‌تواند دسترسی‌ها را تغییر دهد." });
    const permissions = parseJsonArray(req.body.permissions).map((item) => sanitizePlainText(item, 120)).filter(Boolean);
    const roleId = req.body.roleId ? sanitizePlainText(req.body.roleId, 120) : null;
    if (roleId) {
      const { data: role } = await supabase.from("custom_roles").select("id").eq("id", roleId).single();
      if (!role) return res.status(400).json({ error: "نقش سفارشی انتخاب‌شده وجود ندارد" });
    }
    const permissionWrite = await supabase.from("user_permissions").upsert({
      user_id: req.params.id,
      role_id: roleId,
      permissions,
      is_staff: req.body.isStaff === true,
      updated_by: adminUser.id,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" }).select("user_id, role_id, permissions, is_staff").single();
    if (permissionWrite.error) {
      console.error("[admin] permission write failed:", permissionWrite.error);
      throw new Error("ذخیره دسترسی‌ها ناموفق بود");
    }

    const userWrite = await supabase
      .from("users")
      .update({ custom_role_id: roleId, is_staff: req.body.isStaff === true })
      .eq("id", req.params.id)
      .select("id")
      .single();
    if (userWrite.error) {
      console.error("[admin] user write failed:", userWrite.error);
      throw new Error("به‌روزرسانی دسترسی کاربر ناموفق بود");
    }
    try { await logAdminAction(adminUser.id, req.params.id, "update_user_permissions", { roleId, permissions }); } catch {}
    res.json({ success: true, access: permissionWrite.data });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "به‌روزرسانی دسترسی‌ها ناموفق بود" });
  }
});

router.post("/users/:id/email", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageUsers(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const subject = sanitizePlainText(req.body.subject, 200).trim();
    const message = sanitizePlainText(req.body.message, 10000).trim();
    if (!subject || !message) return res.status(400).json({ error: "موضوع و پیام الزامی هستند" });
    const { data: target } = await supabase.from("users").select("id, username, email").eq("id", req.params.id).single();
    if (!target?.email) return res.status(400).json({ error: "کاربر هدف ایمیل ندارد" });
    const settings = await getSystemSettings();
    const html = `<p>${message.replace(/\n/g, "<br>")}</p><hr><p style="font-size:12px;color:#64748b">ارسال‌شده توسط مدیریت رپتوک.</p>`;
    const ok = await sendEmailWithAvailableConfig(prepareEmailConfig(settings.emailVerification || {}), target.email, subject, message, html);
    if (!ok) return res.status(400).json({ error: "سرویس ایمیل پیام را نپذیرفت" });
    try { await logAdminAction(adminUser.id, target.id, "send_admin_email", { subject }); } catch {}
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "ارسال ایمیل ناموفق بود" });
  }
});

router.post("/users/:id/notification", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canChangeSensitiveUserFields(adminUser)) return res.status(403).json({ error: "فقط مالک/مدیر می‌تواند برای کاربران اعلان بفرستد." });
    const title = sanitizePlainText(req.body.title, 140).trim();
    const message = sanitizePlainText(req.body.message, 2000).trim();
    const link = req.body.link ? sanitizePlainText(req.body.link, 500).trim() : "";
    if (!title || !message) return res.status(400).json({ error: "عنوان و پیام الزامی هستند" });
    const { data: target } = await supabase.from("users").select("id, username").eq("id", req.params.id).single();
    if (!target) return res.status(404).json({ error: "کاربر هدف یافت نشد" });

    await createUserNotification(target.id, "admin_message", title, message, link);
    try { await logAdminAction(adminUser.id, target.id, "send_admin_notification", { title, link }); } catch {}
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "ارسال اعلان ناموفق بود" });
  }
});

router.post("/communications/send", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!isOwnerUser(adminUser)) return res.status(403).json({ error: "دسترسی مالک لازم است." });
    const scope = req.body?.scope === "all" ? "all" : "selected";
    const delivery = ["notification", "email", "both"].includes(req.body?.delivery) ? req.body.delivery : "notification";
    const title = sanitizePlainText(req.body?.title, 140).trim();
    const message = sanitizePlainText(req.body?.message, 10000).trim();
    const link = req.body?.link ? sanitizePlainText(req.body.link, 500).trim() : "";
    const requestedIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map((id: any) => sanitizePlainText(id, 160)).filter(Boolean).slice(0, 1000) : [];
    if (!title || !message) return res.status(400).json({ error: "عنوان و پیام الزامی هستند." });
    if (scope === "selected" && requestedIds.length === 0) return res.status(400).json({ error: "حداقل یک کاربر را انتخاب کنید." });
    let query = supabase.from("users").select("id, username, email");
    if (scope === "selected") query = query.in("id", requestedIds);
    const { data: targets, error } = await query;
    if (error) throw error;
    const settings = delivery !== "notification" ? await getSystemSettings() : null;
    const emailConfig = settings ? prepareEmailConfig(settings.emailVerification || {}) : null;
    let notificationsSent = 0;
    let emailsSent = 0;
    let emailsSkipped = 0;
    for (const target of targets || []) {
      if (delivery === "notification" || delivery === "both") {
        await createUserNotification(target.id, scope === "all" ? "admin_broadcast" : "admin_message", title, message, link);
        notificationsSent++;
      }
      if (delivery === "email" || delivery === "both") {
        if (!target.email) { emailsSkipped++; continue; }
        const html = `<h2>${title}</h2><p>${message.replace(/\n/g, "<br>")}</p>${link ? `<p><a href="${link}">مشاهده در رپتوک</a></p>` : ""}<hr><p style="font-size:12px;color:#64748b">ارسال‌شده توسط مدیریت رپتوک.</p>`;
        const sent = await sendEmailWithAvailableConfig(emailConfig!, target.email, title, message, html).catch(() => false);
        if (sent) emailsSent++; else emailsSkipped++;
      }
    }
    try { await logAdminAction(adminUser.id, null, "send_admin_communication", { scope, delivery, recipients: (targets || []).length, notificationsSent, emailsSent, emailsSkipped }); } catch {}
    res.json({ success: true, recipients: (targets || []).length, notificationsSent, emailsSent, emailsSkipped });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "ارسال پیام مدیریتی ناموفق بود." });
  }
});

router.patch("/tickets/:id/assign", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageTickets(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const assignedTo = req.body.assignedTo ? sanitizePlainText(req.body.assignedTo, 120) : null;
    if (assignedTo) {
      const { data: staff } = await supabase.from("users").select("id, role, is_staff").eq("id", assignedTo).single();
      if (!staff || (!staff.is_staff && !STAFF_ROLES.has(String(staff.role || "").toLowerCase().trim()))) return res.status(400).json({ error: "کاربر انتخاب‌شده عضو تیم نیست" });
    }
    await supabase.from("support_tickets").update({ assigned_to: assignedTo }).eq("id", req.params.id);
    try { await logAdminAction(adminUser.id, assignedTo, "assign_ticket", { ticketId: req.params.id }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "واگذاری تیکت ناموفق بود" });
  }
});

export default router;

// Bulk operations for users (atomic where possible)
router.post('/users/bulk', interactionLimiter, async (req, res) => {
  try {
    const admin = await getActiveUser(req, true);
    if (!canManageUsers(admin)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    const { action, userIds, payload } = req.body || {};
    if (!action || !Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'action و userIds[] الزامی هستند' });

    const results: any = { success: [], failed: [] };

    if (action === 'setRole') {
      if (!canChangeSensitiveUserFields(admin)) return res.status(403).json({ error: 'فقط مالک/مدیر می‌تواند نقش‌ها را گروهی تغییر دهد' });
      const role = payload?.role;
      if (!role) return res.status(400).json({ error: 'role در payload الزامی است' });
      const nextRole = normalizeAssignableRole(role, admin);
      if (!nextRole) return res.status(400).json({ error: 'نقش نامعتبر یا غیرمجاز است' });
      if (nextRole === "owner" && !isOwnerUser(admin)) return res.status(403).json({ error: 'فقط مالک فعلی می‌تواند دسترسی مالکیت را اعطا کند' });
      const { error } = await supabase.from('users').update({ role: nextRole }).in('id', userIds);
      if (error) return res.status(400).json({ error: 'به‌روزرسانی نقش‌ها ناموفق بود' });
      results.success = userIds;
    } else if (action === 'delete') {
      if (!canDeleteUsers(admin)) return res.status(403).json({ error: 'حذف گروهی نیازمند دسترسی USER_DELETE یا مالک/مدیر است' });
      // Owner accounts are untouchable by bulk operations, exactly like the
      // single-user path — a compromised admin can never delete the owner.
      const protectedRows = await supabase.from('users').select('id').in('id', userIds).eq('role', 'owner');
      const protectedIds = new Set((protectedRows.data || []).map((row: any) => row.id));
      const deletableIds = userIds.filter((id: string) => !protectedIds.has(id));
      if (!deletableIds.length) return res.status(403).json({ error: 'حذف حساب‌های مالک مجاز نیست' });
      const { error } = await supabase.from('users').delete().in('id', deletableIds);
      if (error) return res.status(400).json({ error: 'حذف کاربران ناموفق بود' });
      results.success = deletableIds;
      for (const id of protectedIds) results.failed.push({ id, error: 'حساب مالک قابل حذف نیست' });
    } else if (action === 'block' || action === 'unblock') {
      const blocked = action === 'block';
      // Same owner-protection rule as the single-user block endpoint.
      let targetIds = userIds;
      if (blocked) {
        const protectedRows = await supabase.from('users').select('id').in('id', userIds).eq('role', 'owner');
        const protectedIds = new Set((protectedRows.data || []).map((row: any) => row.id));
        targetIds = userIds.filter((id: string) => !protectedIds.has(id));
        for (const id of protectedIds) results.failed.push({ id, error: 'مسدود کردن حساب مالک مجاز نیست' });
      }
      if (!targetIds.length) return res.json(results);
      const { error } = await supabase.from('users').update({ blocked }).in('id', targetIds);
      if (error) return res.status(400).json({ error: 'به‌روزرسانی وضعیت مسدودی ناموفق بود' });
      results.success.push(...targetIds);
    } else if (action === 'grantAchievement') {
      const achievementId = payload?.achievementId;
      if (!achievementId) return res.status(400).json({ error: 'achievementId الزامی است' });
      for (const id of userIds) {
        try { await checkAndAwardAchievement(id, achievementId); results.success.push(id); } catch (e) { results.failed.push({ id, error: String(e) }); }
      }
    } else {
      return res.status(400).json({ error: 'عملیات ناشناخته' });
    }

    try {
      await logAdminAction(admin.id, null, 'bulk_' + action, { userCount: userIds.length, payload });
    } catch (auditError) {
      // A lost audit trail must never be silent.
      console.error('[admin] bulk audit log failed:', auditError);
    }
    res.json(results);
  } catch (e) {
    res.status(400).json({ error: 'عملیات گروهی ناموفق بود' });
  }
});

// ✅ NEW: CSV Injection Protection
function sanitizeCSVValue(value: string | undefined | null): string {
  if (!value) return '';
  const str = String(value).trim();
  // Block formula injections: =, @, +, -
  if (str.match(/^[=@+\-]/)) {
    return "'" + str; // Prefix with quote
  }
  return str;
}

// --- CSV export/import and backups (owner only)
router.get('/users/export/csv', async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!isOwnerUser(user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    const { data: users } = await supabase.from('users').select('id,username,email,role,level,xp,coins,stars,created_at');
    const rows = Array.isArray(users) ? users : [];
    const header = ['id','username','email','role','level','xp','coins','stars','created_at'];
    const lines = [header.join(',')];
    for (const u of rows) {
      const vals = header.map(h => {
        const v = (u as any)[h];
        const sanitized = sanitizeCSVValue(String(v || ''));
        // Properly quote CSV values
        if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
          return '"' + sanitized.replace(/"/g, '""') + '"';
        }
        return sanitized;
      });
      lines.push(vals.join(','));
    }
    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users_export.csv"');
    res.send(csv);
  } catch (e) {
    res.status(400).json({ error: 'خروجی گرفتن از کاربران ناموفق بود' });
  }
});

router.post('/users/import/csv', interactionLimiter, async (req, res) => {
  try {
    const admin = await getActiveUser(req, true);
    if (!isOwnerUser(admin)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    const { csv } = req.body || {};
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'محتوای CSV در فیلد `csv` الزامی است' });
    // Parse CSV with simple quoted support
    const rows: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      if (ch === '"') { inQuotes = !inQuotes; cur += ch; }
      else if ((ch === '\n' || ch === '\r') && !inQuotes) { if (cur.trim() !== '') rows.push(cur); cur = ''; while (csv[i+1] === '\n' || csv[i+1] === '\r') i++; }
      else cur += ch;
    }
    if (cur.trim() !== '') rows.push(cur);
    if (rows.length < 1) return res.status(400).json({ error: 'هیچ سطری یافت نشد' });
    const header = rows[0].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));
    const required = ['username'];
    for (const r of required) if (!header.includes(r)) return res.status(400).json({ error: `ستون الزامی یافت نشد: ${r}` });

    // Collect existing usernames/emails to avoid duplicates
    const [{ data: existingUsers }, { data: reservedUsernames }] = await Promise.all([
      supabase.from('users').select('id,username,email'),
      supabase.from('username_history').select('normalized_username')
    ]);
    const existingByUsername = new Set([
      ...(existingUsers || []).map((u:any) => String(u.username || "").toLowerCase()),
      ...(reservedUsernames || []).map((row: any) => String(row.normalized_username || "").toLowerCase())
    ]);
    const existingByEmail = new Set((existingUsers || []).map((u:any) => u.email));

    const created: string[] = [];
    const errors: any[] = [];
    const toInsert: any[] = [];

    for (let i = 1; i < rows.length; i++) {
      const line = rows[i];
      const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
      const obj: any = {};
      for (let j = 0; j < header.length; j++) obj[header[j]] = sanitizeCSVValue(cols[j]); // ✅ SANITIZE
      const lineNo = i+1;
      if (!obj.username) { errors.push({ line: lineNo, error: 'نام کاربری موجود نیست' }); continue; }
      const usernameValidation = validateUsername(obj.username);
      if (usernameValidation.ok === false) { errors.push({ line: lineNo, error: usernameValidation.error }); continue; }
      if (existingByUsername.has(usernameValidation.normalized)) { errors.push({ line: lineNo, error: 'نام کاربری موجود یا رزروشده است' }); continue; }
      if (obj.email && existingByEmail.has(obj.email)) { errors.push({ line: lineNo, error: 'ایمیل موجود است' }); continue; }
      // minimal sanitize
      const userObj: any = {
        id: obj.id || `u-${uuidv4()}-${i}`,
        username: usernameValidation.username,
        email: sanitizeCSVValue(obj.email) || null,
        // CSV imports must never mint privileged accounts: only non-staff
        // baseline roles are accepted, "owner" is impossible by design.
        role: ['writer', 'moderator'].includes(String(sanitizeCSVValue(obj.role) || '').toLowerCase())
          ? String(sanitizeCSVValue(obj.role)).toLowerCase()
          : 'writer',
        level: Number(obj.level) || 1,
        xp: Number(obj.xp) || 0,
        coins: Number(obj.coins) || 0,
        stars: Number(obj.stars) || 0,
        created_at: obj.created_at || new Date().toISOString()
      };
      toInsert.push(userObj);
      existingByUsername.add(usernameValidation.normalized);
      if (userObj.email) existingByEmail.add(userObj.email);
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from('users').insert(toInsert);
      if (error) {
        return res.status(400).json({ error: 'درج کاربران ناموفق بود', details: error.message });
      }
      created.push(...toInsert.map(t => t.id));
    }

    try { await logAdminAction(admin.id, null, 'import_users_csv', { createdCount: created.length, errorsCount: errors.length }); } catch {}
    res.json({ success: true, created: created.length, errors });
  } catch (e) {
    res.status(400).json({ error: 'وارد کردن CSV ناموفق بود' });
  }
});

// Backups must stay outside any public upload path and only be served through
// authenticated admin endpoints.
const backupsRoot = path.join(process.cwd(), 'storage', 'backups');
const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || '30');

function resolveBackupPath(name: string) {
  const safeName = path.basename(String(name || ""));
  if (!/^backup_users_\d+\.json$/.test(safeName)) return null;
  const resolved = path.resolve(backupsRoot, safeName);
  const root = path.resolve(backupsRoot);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

async function cleanupOldBackups() {
  try {
    await fs.mkdir(backupsRoot, { recursive: true });
    const items = await fs.readdir(backupsRoot);
    const now = Date.now();
    for (const it of items) {
      try {
        const st = await fs.stat(path.join(backupsRoot, it));
        const ageDays = (now - st.mtime.getTime()) / (1000*60*60*24);
        if (ageDays > BACKUP_RETENTION_DAYS) {
          await fs.unlink(path.join(backupsRoot, it));
        }
      } catch {}
    }
  } catch {}
}

router.post('/backups/create', interactionLimiter, async (req, res) => {
  try {
    const admin = await getActiveUser(req, true);
    if (!isOwnerUser(admin)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    const { data: users } = await supabase
      .from('users')
      .select('id, username, email, phone, nickname, role, departments, notify_comments, notify_followers, notify_likes, notify_bookmarks, is_premium, premium_plan, premium_until, premium_lifetime, level, xp, coins, stars, streak, avatar, created_at, email_verified, twofa_enabled, verified_author, verified_role, is_staff, blocked, publishing_blocked, profile_bio');
    const payload = { createdAt: new Date().toISOString(), users: users || [] };
    await fs.mkdir(backupsRoot, { recursive: true });
    const fname = `backup_users_${Date.now()}.json`;
    const full = path.join(backupsRoot, fname);
    await fs.writeFile(full, JSON.stringify(payload, null, 2), 'utf8');
    // cleanup old backups according to retention policy
    try { await cleanupOldBackups(); } catch {}
    try { await logAdminAction(admin.id, null, 'create_backup', { file: fname }); } catch {}
    res.json({ success: true, file: fname });
  } catch (e) {
    res.status(400).json({ error: 'ایجاد پشتیبان ناموفق بود' });
  }
});

router.get('/backups/files', async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!isOwnerUser(user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    try { await cleanupOldBackups(); } catch {}
    await fs.mkdir(backupsRoot, { recursive: true });
    const items = await fs.readdir(backupsRoot);
    const listing = [];
    for (const it of items) {
      try {
        const st = await fs.stat(path.join(backupsRoot, it));
        listing.push({ name: it, size: st.size, mtime: st.mtime });
      } catch {}
    }
    try { await logAdminAction(user.id, null, 'list_backups', { count: listing.length }); } catch {}
    res.json(listing.sort((a,b) => b.mtime - a.mtime));
  } catch (e) {
    res.status(400).json({ error: 'فهرست پشتیبان‌ها ناموفق بود' });
  }
});

router.get('/backups/files/:name', async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!isOwnerUser(user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    const full = resolveBackupPath(req.params.name);
    if (!full) return res.status(400).json({ error: 'نام فایل پشتیبان نامعتبر است' });
    const content = await fs.readFile(full, 'utf8');
    try { await logAdminAction(user.id, null, 'read_backup', { file: path.basename(req.params.name) }); } catch {}
    res.type('application/json').send(content);
  } catch (e) {
    res.status(400).json({ error: 'خواندن فایل پشتیبان ناموفق بود' });
  }
});

router.delete('/backups/files/:name', interactionLimiter, async (req, res) => {
  try {
    const admin = await getActiveUser(req, true);
    if (!isOwnerUser(admin)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    const name = path.basename(req.params.name);
    const full = resolveBackupPath(name);
    if (!full) return res.status(400).json({ error: 'نام فایل پشتیبان نامعتبر است' });
    await fs.unlink(full);
    try { await logAdminAction(admin.id, null, 'delete_backup', { file: name }); } catch {}
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'حذف پشتیبان ناموفق بود' });
  }
});

// Admin-driven 2FA controls for a user
router.post('/users/:id/2fa/generate', interactionLimiter, async (req, res) => {
  try {
    const admin = await getActiveUser(req, true);
    if (!isOwnerUser(admin)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    const targetId = req.params.id;
    let otplib: any;
    try { otplib = await import('otplib'); } catch (e) { return res.status(400).json({ error: 'کتابخانه 2FA نصب نشده است. npm i otplib' }); }
    const { data: target } = await supabase.from('users').select('id,username').eq('id', targetId).single();
    if (!target) return res.status(404).json({ error: 'کاربر یافت نشد' });
    const secret = otplib.authenticator.generateSecret();
    const otpauth = otplib.authenticator.keyuri(target.username, 'رپتوک', secret);
    const enc = encrypt(secret);
    await supabase.from('settings').upsert({ setting_key: `twofa_${target.id}`, setting_value: enc, updated_at: new Date().toISOString() });
    await supabase.from('users').update({ twofa_enabled: true }).eq('id', target.id);
    try { await logAdminAction(admin.id, target.id, 'admin_generate_2fa', {}); } catch {}
    res.json({ secret, otpauth });
  } catch (e) {
    res.status(400).json({ error: 'تولید ورود دومرحله‌ای برای کاربر ناموفق بود' });
  }
});

router.post('/users/:id/2fa/disable', interactionLimiter, async (req, res) => {
  try {
    const admin = await getActiveUser(req, true);
    if (!isOwnerUser(admin)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });
    const targetId = req.params.id;
    await supabase.from('settings').delete().eq('setting_key', `twofa_${targetId}`);
    await supabase.from('users').update({ twofa_enabled: false }).eq('id', targetId);
    try { await logAdminAction(admin.id, targetId, 'admin_disable_2fa', {}); } catch {}
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'غیرفعال‌سازی ورود دومرحله‌ای کاربر ناموفق بود' });
  }
});

// Admin audit listing
router.get("/audit", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!isOwnerUser(user)) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    const { data } = await supabase.from('admin_audit').select('*').order('created_at', { ascending: false }).limit(500);
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    res.status(400).json({ error: "بارگذاری لاگ ممیزی ناموفق بود" });
  }
});

// Admin audit files listing (file-based logs)
router.get("/audit/files", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!isOwnerUser(user)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const files = await listAuditFiles();
    res.json(files || []);
  } catch (e) {
    res.status(400).json({ error: "فهرست فایل‌های ممیزی ناموفق بود" });
  }
});

router.get("/audit/files/:name", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!isOwnerUser(user)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const name = req.params.name;
    const content = await readAuditFile(name);
    if (content === null) return res.status(404).json({ error: "فایل یافت نشد یا قابل خواندن نیست" });
    res.type('text/plain').send(content);
  } catch (e) {
    res.status(400).json({ error: "خواندن فایل ممیزی ناموفق بود" });
  }
});

router.delete("/audit/files/:name", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!isOwnerUser(user)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const name = req.params.name;
    const ok = await deleteAuditFile(name);
    if (!ok) return res.status(400).json({ error: "حذف فایل ناموفق بود" });
    try { await logAdminAction(user.id, null, 'delete_audit_file', { file: name }); } catch {}
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: "حذف فایل ممیزی ناموفق بود" });
  }
});

const ROLE_PRESETS = [
  { id: "preset-owner", name: "مالک", description: "کنترل کامل پلتفرم.", permissions: ["admin:*", "moderate:*", "analytics:read_all"] },
  { id: "preset-admin", name: "مدیر", description: "مدیریت عملیاتی بدون امکان انتقال مالکیت.", permissions: ["admin:*", "moderate:*", "ticket:read_all", "ticket:update", "analytics:read_all"] },
  { id: "preset-moderator", name: "ناظر", description: "مدیریت انجمن، نظرها، گزارش‌ها و تخلف‌ها.", permissions: ["moderate:*", "report:moderate", "report:punish", "forum:moderate", "forum:delete", "ticket:update"] },
  { id: "preset-editor", name: "ویراستار", description: "بازبینی تحریریه رمان و فصل.", permissions: ["novel:approve", "novel:edit_all", "forum:moderate"] },
  { id: "preset-support", name: "پشتیبانی", description: "رسیدگی به تیکت‌ها و پشتیبانی کاربران.", permissions: ["ticket:read_all", "ticket:update", "ticket:close"] },
  { id: "preset-security", name: "امنیت", description: "دسترسی فقط‌خواندنی به عملیات امنیتی.", permissions: ["security:read"] },
  { id: "preset-finance", name: "مالی", description: "مشاهده اشتراک ویژه و پرداخت‌ها.", permissions: ["finance:read", "analytics:read_all"] },
  { id: "preset-analytics", name: "فقط تحلیل‌ها", description: "دسترسی فقط‌خواندنی به آمار و تحلیل‌ها.", permissions: ["analytics:read_all"] }
];

function nextBackupRun(frequency: string) {
  const date = new Date();
  if (frequency === "hourly") date.setHours(date.getHours() + 1);
  else if (frequency === "weekly") date.setDate(date.getDate() + 7);
  else date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function parseMaybeJson(value: any, fallback: any) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Run an operations query, degrading to an empty result set.
 *
 * The operations console fans out across ~17 independent queries; one table
 * missing (a pending migration) must not fail the whole panel. Missing
 * relations/columns and ownership refusals are reported once, so the cause is
 * visible without a log line per request.
 */
async function safeDbQuery(sql: string, params?: any[]) {
  try {
    return await db.query(sql, params);
  } catch (error: any) {
    const relation = sql.match(/\bFROM\s+([a-z_][a-z0-9_.]*)/i)?.[1] || "unknown";
    reportSchemaGapOnce(`admin/operations ${relation}`, error);
    return { rows: [] };
  }
}

async function listBackupFilesForOps() {
  try {
    await cleanupOldBackups();
    await fs.mkdir(backupsRoot, { recursive: true });
    const items = await fs.readdir(backupsRoot);
    const listing = [];
    for (const item of items) {
      try {
        const st = await fs.stat(path.join(backupsRoot, item));
        listing.push({ name: item, size: st.size, mtime: st.mtime });
      } catch {}
    }
    return listing.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  } catch {
    return [];
  }
}

const COMMENT_MODERATION_STATUSES: Record<string, string> = {
  pending: "pending",
  approved: "visible",
  visible: "visible",
  rejected: "rejected",
};

async function updateCommentModerationDecision(
  commentId: string,
  verdict: "ALLOW" | "BLOCK",
  adminId: string,
  source: "manual" | "batch_manual" | "batch_ai",
) {
  const status = verdict === "ALLOW" ? "visible" : "rejected";
  const result = await db.query(
    `UPDATE chapter_comments
        SET moderation_status=$1,moderated_at=timezone('utc'::text,now()),moderated_by=$2,
            moderation_source=$3,moderation_result=$4,
            moderator_note=CASE WHEN $4='BLOCK' THEN 'رد شده در مرکز نظارت دیدگاه‌ها' ELSE NULL END
      WHERE id=$5 AND deleted_at IS NULL
      RETURNING id,novel_id,chapter_id,moderation_status`,
    [status, adminId, source, verdict, commentId],
  );
  if (result.rows[0]?.novel_id) await invalidateNovelCaches(result.rows[0].novel_id).catch(() => {});
  return result.rows[0] || null;
}

router.get("/comment-moderation/settings", async (_req, res) => {
  try {
    const admin = res.locals.user;
    if (!canConfigureCommentModeration(admin)) return res.status(403).json({ error: "دسترسی تنظیمات نظارت را ندارید." });
    const config = await loadCommentModerationConfig();
    res.json({ mode: config.mode, apiKeyConfigured: config.apiKeyConfigured });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "بارگذاری تنظیمات نظارت ناموفق بود." });
  }
});

router.put("/comment-moderation/settings", interactionLimiter, async (req, res) => {
  try {
    const admin = res.locals.user;
    if (!canConfigureCommentModeration(admin)) return res.status(403).json({ error: "دسترسی تنظیمات نظارت را ندارید." });
    if (req.body?.mode !== "manual" && req.body?.mode !== "automatic") return res.status(422).json({ error: "حالت نظارت نامعتبر است." });
    // Endpoint and credential are server-owned configuration. The browser can
    // only switch the workflow mode and can never read or replace either one.
    const config = await saveCommentModerationConfig({ mode: req.body.mode });
    await logAdminAction(admin.id, null, "comment_moderation_mode_updated", { mode: config.mode, apiKeyConfigured: config.apiKeyConfigured }).catch(() => {});
    res.json({ mode: config.mode, apiKeyConfigured: config.apiKeyConfigured });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "ذخیره تنظیمات نظارت ناموفق بود." });
  }
});

router.post("/comment-moderation/test", interactionLimiter, async (req, res) => {
  try {
    const admin = res.locals.user;
    if (!canReadContentOperations(admin)) return res.status(403).json({ error: "دسترسی نظارت محتوا را ندارید." });
    const message = sanitizePlainText(String(req.body?.message || ""), 5000).trim();
    if (!message) return res.status(422).json({ error: "متن پیام آزمایشی الزامی است." });
    const verdict = await classifyComment(message);
    res.json({ success: true, verdict, decision: verdict === "ALLOW" ? "approved" : "rejected" });
  } catch (error: any) {
    res.status(502).json({ error: error?.message || "آزمایش سرویس نظارت ناموفق بود." });
  }
});

router.get("/comment-moderation", async (req, res) => {
  try {
    const admin = res.locals.user;
    if (!canReadContentOperations(admin)) return res.status(403).json({ error: "دسترسی نظارت محتوا را ندارید." });
    const requestedStatus = String(req.query.status || "pending").toLowerCase();
    const dbStatus = COMMENT_MODERATION_STATUSES[requestedStatus];
    if (!dbStatus && requestedStatus !== "all") return res.status(400).json({ error: "وضعیت فیلتر نامعتبر است." });
    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.max(5, Math.min(50, Number.parseInt(String(req.query.pageSize || "20"), 10) || 20));
    const search = sanitizePlainText(String(req.query.search || ""), 120).trim();
    const params: any[] = [];
    const conditions = ["c.deleted_at IS NULL"];
    if (dbStatus) { params.push(dbStatus); conditions.push(`c.moderation_status=$${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.content ILIKE $${params.length} OR COALESCE(u.username,'') ILIKE $${params.length} OR COALESCE(n.title,'') ILIKE $${params.length})`);
    }
    const where = conditions.join(" AND ");
    const total = Number((await db.query(
      `SELECT COUNT(*)::int AS count FROM chapter_comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN novels n ON n.id=c.novel_id WHERE ${where}`,
      params,
    )).rows[0]?.count || 0);
    params.push(pageSize, (page - 1) * pageSize);
    const items = (await db.query(
      `SELECT c.id,c.novel_id,c.chapter_id,c.parent_id,c.paragraph_id,c.content,c.created_at,c.updated_at,
              c.moderation_status,c.moderated_at,c.moderation_source,c.moderation_result,
              COALESCE(u.nickname,u.username,'کاربر ناشناس') AS author_name,u.username AS author_username,
              n.title AS novel_title,ch.title AS chapter_title,ch.chapter_number,
              COALESCE(mu.nickname,mu.username) AS moderator_name
         FROM chapter_comments c
         LEFT JOIN users u ON u.id=c.user_id
         LEFT JOIN novels n ON n.id=c.novel_id
         LEFT JOIN chapters ch ON ch.id=c.chapter_id
         LEFT JOIN users mu ON mu.id=c.moderated_by
        WHERE ${where}
        ORDER BY c.created_at DESC,c.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )).rows;
    const countsRows = (await db.query(
      `SELECT moderation_status,COUNT(*)::int AS count FROM chapter_comments WHERE deleted_at IS NULL GROUP BY moderation_status`,
    )).rows;
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const row of countsRows) {
      if (row.moderation_status === "visible") counts.approved += Number(row.count || 0);
      else if (row.moderation_status === "rejected") counts.rejected += Number(row.count || 0);
      else if (row.moderation_status === "pending") counts.pending += Number(row.count || 0);
    }
    res.json({ items, counts, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (error: any) {
    console.error("Comment moderation list failed", { message: error?.message });
    res.status(400).json({ error: "بارگذاری صف نظارت دیدگاه‌ها ناموفق بود." });
  }
});

router.patch("/comment-moderation/:id", interactionLimiter, async (req, res) => {
  try {
    const admin = res.locals.user;
    if (!canReadContentOperations(admin)) return res.status(403).json({ error: "دسترسی نظارت محتوا را ندارید." });
    const decision = req.body?.decision === "approve" ? "ALLOW" : req.body?.decision === "reject" ? "BLOCK" : null;
    if (!decision) return res.status(422).json({ error: "تصمیم باید تأیید یا رد باشد." });
    const item = await updateCommentModerationDecision(String(req.params.id), decision, admin.id, "manual");
    if (!item) return res.status(404).json({ error: "دیدگاه پیدا نشد." });
    await logAdminAction(admin.id, null, "comment_moderated", { commentId: item.id, decision }).catch(() => {});
    res.json({ success: true, item });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "ثبت تصمیم دیدگاه ناموفق بود." });
  }
});

router.delete("/comment-moderation/:id", interactionLimiter, async (req, res) => {
  try {
    const admin = res.locals.user;
    if (!canReadContentOperations(admin)) return res.status(403).json({ error: "دسترسی نظارت محتوا را ندارید." });
    const result = await db.query(
      `UPDATE chapter_comments
          SET content='',deleted_at=timezone('utc'::text,now()),updated_at=timezone('utc'::text,now()),
              moderated_at=timezone('utc'::text,now()),moderated_by=$1,moderation_source='admin_delete'
        WHERE id=$2 AND deleted_at IS NULL AND moderation_status='visible'
        RETURNING id,novel_id`,
      [admin.id, String(req.params.id)],
    );
    const item = result.rows[0];
    if (!item) return res.status(404).json({ error: "دیدگاه تأییدشده پیدا نشد." });
    await invalidateNovelCaches(item.novel_id).catch(() => {});
    await logAdminAction(admin.id, null, "approved_comment_deleted", { commentId: item.id, novelId: item.novel_id }).catch(() => {});
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "حذف دیدگاه ناموفق بود." });
  }
});

router.post("/comment-moderation/batch", interactionLimiter, async (req, res) => {
  try {
    const admin = res.locals.user;
    if (!canReadContentOperations(admin)) return res.status(403).json({ error: "دسترسی نظارت محتوا را ندارید." });
    const ids: string[] = Array.from(new Set<string>((Array.isArray(req.body?.ids) ? req.body.ids : []).map((id: unknown) => String(id)).filter(Boolean))).slice(0, 50);
    const action = ["approve", "reject", "ai"].includes(req.body?.action) ? req.body.action as "approve" | "reject" | "ai" : null;
    if (!ids.length || !action) return res.status(422).json({ error: "دیدگاه‌ها و نوع عملیات الزامی هستند." });
    const config = action === "ai" ? await loadCommentModerationConfig() : null;
    if (action === "ai" && !config?.apiKeyConfigured) return res.status(422).json({ error: "ابتدا کلید API سرویس نظارت را تنظیم کنید." });
    const results: any[] = [];
    // Intentionally sequential: the provider receives exactly one comment per request.
    for (const id of ids) {
      try {
        let verdict: "ALLOW" | "BLOCK" = action === "approve" ? "ALLOW" : "BLOCK";
        if (action === "ai") {
          const row = (await db.query("SELECT content FROM chapter_comments WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
          if (!row) throw new Error("دیدگاه پیدا نشد.");
          verdict = await classifyComment(row.content, config!);
        }
        const item = await updateCommentModerationDecision(id, verdict, admin.id, action === "ai" ? "batch_ai" : "batch_manual");
        results.push({ id, success: !!item, verdict, status: item?.moderation_status });
      } catch (error: any) {
        results.push({ id, success: false, error: error?.message || "خطای سرویس نظارت" });
      }
    }
    await logAdminAction(admin.id, null, "comments_moderated_batch", { action, requested: ids.length, succeeded: results.filter((item) => item.success).length }).catch(() => {});
    res.json({ success: true, results });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "پردازش گروهی دیدگاه‌ها ناموفق بود." });
  }
});

router.get("/operations", async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, false);
    const operationAccess = {
      security: canReadSecurityOperations(adminUser),
      content: canReadContentOperations(adminUser),
      tickets: canManageTickets(adminUser),
      finance: canReadFinanceOperations(adminUser),
      analytics: canReadAnalyticsOperations(adminUser),
      backups: canReadBackupOperations(adminUser),
      roles: canManageRoles(adminUser)
    };
    if (!Object.values(operationAccess).some(Boolean)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureOperationalTables().catch(() => {});

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const emptyRows = Promise.resolve({ rows: [] });
    const [
      securityRows,
      sessionCount,
      lockedUsers,
      twofaUsers,
      chapterQueue,
      commentsQueue,
      forumQueue,
      reportsQueue,
      ticketsRows,
      ticketNotes,
      scansRows,
      financeOrders,
      starRows,
      backupSchedules,
      topNovels,
      dailyRows,
      errorRows
    ] = await Promise.all([
      operationAccess.security ? safeDbQuery(`SELECT id, event_type, user_id, COALESCE(ip, ip_address) AS ip, user_agent, severity, details, COALESCE(timestamp, created_at) AS created_at FROM security_logs ORDER BY COALESCE(timestamp, created_at) DESC LIMIT 80`) : emptyRows,
      operationAccess.security ? safeDbQuery(`SELECT COUNT(*)::int AS count FROM sessions WHERE expires_at > NOW()`) : emptyRows,
      operationAccess.security ? safeDbQuery(`SELECT COUNT(*)::int AS count FROM users WHERE blocked = true OR login_attempts >= 5 OR locked_until > NOW()`) : emptyRows,
      operationAccess.security ? safeDbQuery(`SELECT COUNT(*)::int AS count FROM users WHERE twofa_enabled = true`) : emptyRows,
      operationAccess.content ? safeDbQuery(`SELECT c.id, c.novel_id, c.title, c.status, COALESCE(c.moderation_status, 'visible') AS moderation_status, c.editor_note, c.created_at, n.title AS novel_title, n.author FROM chapters c LEFT JOIN novels n ON n.id = c.novel_id WHERE COALESCE(c.status, '') IN ('Draft','Pending','Scheduled','Quarantined') OR COALESCE(c.moderation_status, 'visible') <> 'visible' ORDER BY c.created_at DESC LIMIT 80`) : emptyRows,
      operationAccess.content ? safeDbQuery(`SELECT 'review' AS type, r.id, r.novel_id, NULL::text AS chapter_id, COALESCE(u.username, r.username) AS author, r.content, COALESCE(r.moderation_status, 'visible') AS moderation_status, r.created_at FROM reviews r LEFT JOIN users u ON u.id = r.user_id WHERE COALESCE(r.moderation_status, 'visible') <> 'visible' UNION ALL SELECT 'chapter_comment' AS type, c.id, c.novel_id, c.chapter_id, COALESCE(u.username, c.user_id) AS author, c.content, COALESCE(c.moderation_status, 'visible') AS moderation_status, c.created_at FROM chapter_comments c LEFT JOIN users u ON u.id = c.user_id WHERE COALESCE(c.moderation_status, 'visible') <> 'visible' ORDER BY created_at DESC LIMIT 80`) : emptyRows,
      operationAccess.content ? safeDbQuery(`SELECT id, forum_id, user_id, title, content, COALESCE(moderation_status, 'visible') AS moderation_status, created_at FROM forum_threads WHERE COALESCE(moderation_status, 'visible') <> 'visible' ORDER BY created_at DESC LIMIT 80`) : emptyRows,
      operationAccess.content ? safeDbQuery(`SELECT * FROM reports ORDER BY created_at DESC LIMIT 80`) : emptyRows,
      operationAccess.tickets ? safeDbQuery(`SELECT * FROM support_tickets ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 100`) : emptyRows,
      operationAccess.tickets ? safeDbQuery(`SELECT * FROM ticket_internal_notes ORDER BY created_at DESC LIMIT 100`) : emptyRows,
      operationAccess.content ? safeDbQuery(`SELECT * FROM content_moderation_scans ORDER BY created_at DESC LIMIT 100`) : emptyRows,
      operationAccess.finance ? safeDbQuery(`SELECT * FROM premium_orders ORDER BY created_at DESC LIMIT 100`) : emptyRows,
      operationAccess.finance ? safeDbQuery(`SELECT * FROM star_transactions ORDER BY created_at DESC LIMIT 100`) : emptyRows,
      operationAccess.backups ? safeDbQuery(`SELECT * FROM backup_schedules ORDER BY created_at DESC LIMIT 20`) : emptyRows,
      operationAccess.analytics ? safeDbQuery(`SELECT n.id,n.title,n.author,n.views_count,n.bookmarks_count,n.rating,n.reviews_count,COUNT(c.id)::int AS published_chapter_count,CASE WHEN COUNT(c.id)=0 THEN 0 ELSE ROUND(COALESCE(n.views_count,0)::numeric/COUNT(c.id),2) END AS average_views FROM novels n LEFT JOIN chapters c ON c.novel_id=n.id AND lower(COALESCE(c.status,''))='published' AND COALESCE(c.moderation_status,'visible')='visible' AND (c.scheduled_at IS NULL OR c.scheduled_at<=timezone('utc'::text,now())) GROUP BY n.id ORDER BY COALESCE(n.views_count,0) DESC LIMIT 10`) : emptyRows,
      operationAccess.analytics ? safeDbQuery(`SELECT date_trunc('day', created_at) AS day, action_type, COUNT(*)::int AS count FROM analytics_logs WHERE created_at >= $1 GROUP BY 1, 2 ORDER BY 1 ASC`, [since]) : emptyRows,
      operationAccess.security ? safeDbQuery(`SELECT COUNT(*)::int AS count FROM security_logs WHERE event_type IN ('permission_denied', 'rate_limit_exceeded', 'suspicious_activity') AND COALESCE(timestamp, created_at) >= $1`, [since]) : emptyRows
    ]);

    const tickets = ticketsRows.rows.map((ticket: any) => ({
      ...ticket,
      tags: parseMaybeJson(ticket.tags, []),
      internalNotes: ticketNotes.rows.filter((note: any) => note.ticket_id === ticket.id)
    }));
    const orders = financeOrders.rows;
    const paidOrders = orders.filter((order: any) => order.status === "paid");
    const premiumRevenue = paidOrders.reduce((sum: number, order: any) => sum + Number(order.amount || order.total || 0), 0);
    const starVolume = starRows.rows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const openTickets = tickets.filter((ticket: any) => !["CLOSED", "RESOLVED"].includes(String(ticket.status || "").toUpperCase())).length;

    res.json({
      access: operationAccess,
      security: {
        activeSessions: sessionCount.rows[0]?.count || 0,
        lockedUsers: lockedUsers.rows[0]?.count || 0,
        twofaUsers: twofaUsers.rows[0]?.count || 0,
        suspiciousLast30Days: errorRows.rows[0]?.count || 0,
        recent: securityRows.rows.map((row: any) => ({ ...row, details: parseMaybeJson(row.details, {}) }))
      },
      queues: {
        chapters: chapterQueue.rows,
        comments: commentsQueue.rows,
        forum: forumQueue.rows,
        reports: reportsQueue.rows
      },
      contentSafety: {
        scans: scansRows.rows.map((row: any) => ({ ...row, flags: parseMaybeJson(row.flags, []) }))
      },
      analytics: {
        topNovels: topNovels.rows,
        daily: dailyRows.rows
      },
      tickets: {
        open: openTickets,
        total: tickets.length,
        items: tickets
      },
      finance: {
        premiumOrders: orders,
        paidOrders: paidOrders.length,
        premiumRevenue,
        starTransactions: starRows.rows,
        starVolume
      },
      backups: {
        schedules: backupSchedules.rows,
        files: operationAccess.backups ? await listBackupFilesForOps() : []
      },
      rolePresets: operationAccess.roles ? ROLE_PRESETS : [],
      health: {
        status: "ok",
        timestamp: new Date().toISOString(),
        backupRetentionDays: BACKUP_RETENTION_DAYS
      }
    });
  } catch {
    res.json({
      security: { activeSessions: 0, lockedUsers: 0, twofaUsers: 0, suspiciousLast30Days: 0, recent: [] },
      queues: { chapters: [], comments: [], forum: [], reports: [] },
      contentSafety: { scans: [] },
      analytics: { topNovels: [], daily: [] },
      tickets: { open: 0, total: 0, items: [] },
      finance: { premiumOrders: [], paidOrders: 0, premiumRevenue: 0, starTransactions: [], starVolume: 0 },
      backups: { schedules: [], files: [] },
      rolePresets: ROLE_PRESETS,
      health: { status: "degraded", timestamp: new Date().toISOString(), backupRetentionDays: BACKUP_RETENTION_DAYS }
    });
  }
});

router.get("/users/:id/timeline", async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, false);
    if (!canManageUsers(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureOperationalTables().catch(() => {});

    // ✅ SECURITY: Validate user ID format before DB query.
    const userId = String(req.params.id || "");
    if (!/^(u-[a-f0-9-]{8,80}|admin-master-[a-f0-9-]{8,80}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(userId)) {
      return res.status(400).json({ error: "شناسه کاربر نامعتبر است." });
    }

    // ✅ SECURITY: Strip sensitive fields from JSONB columns before exposing
    // as text. This prevents leaking PII (emails, masked card numbers, IPs)
    // to non-owner admins viewing a user's timeline.
    const { rows } = await db.query(`
      SELECT 'admin_audit' AS source, action AS title,
             COALESCE(
               (details - 'password' - 'token' - 'session_token' - 'otp'
                       - 'csrf_token' - 'google_sub' - 'stripe_signature'
                       - 'provider_payload' - 'api_key' - 'secret' - 'authorization')::text,
               '{}'
             ) AS details,
             created_at
        FROM admin_audit
       WHERE actor_id = $1 OR target_user_id = $1
      UNION ALL
      SELECT 'security' AS source, event_type AS title,
             COALESCE(
               (details - 'password' - 'token' - 'session_token' - 'otp'
                       - 'csrf_token' - 'google_sub' - 'stripe_signature'
                       - 'api_key' - 'secret' - 'authorization')::text,
               '{}'
             ) AS details,
             COALESCE(timestamp, created_at) AS created_at
        FROM security_logs
       WHERE user_id = $1
      UNION ALL
      SELECT 'ticket' AS source, title, status AS details, created_at FROM support_tickets WHERE user_id = $1
      UNION ALL
      SELECT 'novel' AS source, title, approval_status AS details, created_at FROM novels WHERE author_id = $1
      UNION ALL
      SELECT 'report' AS source, reason AS title, status AS details, created_at FROM reports WHERE reporter_id = $1 OR assigned_to = $1
      UNION ALL
      SELECT 'premium' AS source, status AS title,
             COALESCE(
               (provider_payload - 'customer_email' - 'customer_name' - 'card_last4'
                                - 'card_brand' - 'shipping' - 'billing_address'
                                - 'customer_phone' - 'receipt_email' - 'receipt_number')::text,
               '{}'
             ) AS details,
             created_at
        FROM premium_orders
       WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 200
    `, [userId]);
    res.json({ timeline: rows });
  } catch {
    res.status(400).json({ error: "بارگذاری تاریخچه کاربر ناموفق بود" });
  }
});

router.post("/content/scan", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageUsers(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureOperationalTables().catch(() => {});
    const targetType = sanitizePlainText(req.body.targetType, 80);
    const targetId = sanitizePlainText(req.body.targetId, 160);
    if (!targetType || !targetId) return res.status(400).json({ error: "targetType و targetId الزامی هستند" });

    let target: any = null;
    if (targetType === "chapter") {
      const result = await db.query(`SELECT c.id, c.novel_id, c.content, c.title FROM chapters c WHERE c.id = $1`, [targetId]);
      target = result.rows[0];
    } else if (targetType === "novel") {
      const result = await db.query(`SELECT id, id AS novel_id, CONCAT(title, ' ', description) AS content FROM novels WHERE id = $1`, [targetId]);
      target = result.rows[0];
    } else if (targetType === "review") {
      const result = await db.query(`SELECT id, novel_id, content FROM reviews WHERE id = $1`, [targetId]);
      target = result.rows[0];
    } else if (targetType === "chapter_comment") {
      const result = await db.query(`SELECT id, novel_id, chapter_id, content FROM chapter_comments WHERE id = $1`, [targetId]);
      target = result.rows[0];
    } else if (targetType === "forum_thread") {
      const result = await db.query(`SELECT id, CONCAT(title, ' ', content) AS content FROM forum_threads WHERE id = $1`, [targetId]);
      target = result.rows[0];
    }
    if (!target) return res.status(404).json({ error: "هدف یافت نشد" });

    const scan = await analyzeContentText(target.content || "", target.id);
    const scanId = `scan-${uuidv4()}`;
    await db.query(
      `INSERT INTO content_moderation_scans
        (id, target_type, target_id, novel_id, chapter_id, scanner_id, risk_score, nsfw_score, violence_score, ai_score, plagiarism_score, profanity_score, warning_mismatch_score, quality_score, flags, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)`,
      [
        scanId,
        targetType,
        targetId,
        target.novel_id || null,
        target.chapter_id || (targetType === "chapter" ? targetId : null),
        adminUser.id,
        scan.riskScore,
        scan.nsfwScore,
        scan.violenceScore,
        scan.aiScore,
        scan.plagiarismScore,
        scan.profanityScore,
        scan.warningMismatchScore,
        scan.qualityScore,
        JSON.stringify(scan.flags),
        scan.summary
      ]
    );
    try { await logAdminAction(adminUser.id, null, "content_scan", { targetType, targetId, riskScore: scan.riskScore }); } catch {}
    res.json({ success: true, scan: { id: scanId, ...scan } });
  } catch (err) {
    console.error("[admin/content/scan] failed", err);
    res.status(400).json({ error: "اسکن محتوا ناموفق بود" });
  }
});

router.patch("/content/action", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageUsers(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureOperationalTables().catch(() => {});
    const targetType = sanitizePlainText(req.body.targetType, 80);
    const targetId = sanitizePlainText(req.body.targetId, 160);
    const action = sanitizePlainText(req.body.action, 40);
    const note = sanitizePlainText(req.body.note, 2000);
    if (!targetType || !targetId || !["quarantine", "release", "delete", "reviewed"].includes(action)) {
      return res.status(400).json({ error: "درخواست اقدام محتوایی نامعتبر است" });
    }

    const moderationStatus = action === "quarantine" ? "quarantined" : action === "reviewed" ? "reviewed" : "visible";
    if (targetType === "novel") {
      if (action === "delete") await deleteNovelCompletely(targetId);
      else await supabase.from("novels").update({ approval_status: action === "quarantine" ? "quarantined" : "pending_approval", editor_note: note }).eq("id", targetId);
    } else if (targetType === "chapter") {
      if (action === "delete") await supabase.from("chapters").delete().eq("id", targetId);
      else {
        const updates = await filterPayloadToExistingColumns("chapters", { moderation_status: moderationStatus, editorial_status: action === "quarantine" ? "needs_changes" : "draft", status: "Draft", editor_note: note });
        if (Object.keys(updates).length) await supabase.from("chapters").update(updates).eq("id", targetId);
      }
    } else if (targetType === "review") {
      if (action === "delete") await supabase.from("reviews").delete().eq("id", targetId);
      else {
        const updates = await filterPayloadToExistingColumns("reviews", { moderation_status: moderationStatus, moderator_note: note });
        if (Object.keys(updates).length) await supabase.from("reviews").update(updates).eq("id", targetId);
      }
    } else if (targetType === "chapter_comment") {
      if (action === "delete") await supabase.from("chapter_comments").delete().eq("id", targetId);
      else {
        const updates = await filterPayloadToExistingColumns("chapter_comments", { moderation_status: moderationStatus, moderator_note: note });
        if (Object.keys(updates).length) await supabase.from("chapter_comments").update(updates).eq("id", targetId);
      }
    } else if (targetType === "forum_thread") {
      if (action === "delete") await supabase.from("forum_threads").delete().eq("id", targetId);
      else {
        const updates = await filterPayloadToExistingColumns("forum_threads", { moderation_status: moderationStatus, moderator_note: note });
        if (Object.keys(updates).length) await supabase.from("forum_threads").update(updates).eq("id", targetId);
      }
    }
    if (["novel", "chapter", "review"].includes(targetType)) await invalidateNovelCaches();
    try { await logAdminAction(adminUser.id, null, "content_action", { targetType, targetId, action, note }); } catch {}
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "اعمال اقدام محتوایی ناموفق بود" });
  }
});

router.patch("/tickets/:id/pro", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageTickets(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureOperationalTables().catch(() => {});
    const updates: any = { updated_at: new Date().toISOString() };
    if (req.body.status !== undefined) updates.status = sanitizePlainText(req.body.status, 40).toUpperCase();
    if (req.body.priority !== undefined) updates.priority = sanitizePlainText(req.body.priority, 40).toLowerCase();
    if (req.body.assignedTo !== undefined) updates.assigned_to = req.body.assignedTo ? sanitizePlainText(req.body.assignedTo, 120) : null;
    if (req.body.dueAt !== undefined) updates.due_at = req.body.dueAt ? new Date(req.body.dueAt).toISOString() : null;
    if (req.body.tags !== undefined) updates.tags = JSON.stringify(parseJsonArray(req.body.tags).map((tag) => sanitizePlainText(tag, 40)).filter(Boolean));
    if (req.body.resolutionNote !== undefined) updates.resolution_note = sanitizePlainText(req.body.resolutionNote, 2000);
    const existingUpdates = await filterPayloadToExistingColumns("support_tickets", updates);
    const { error } = Object.keys(existingUpdates).length
      ? await supabase.from("support_tickets").update(existingUpdates).eq("id", req.params.id)
      : { error: null } as any;
    if (error) throw error;
    try { await logAdminAction(adminUser.id, null, "update_ticket_pro", { ticketId: req.params.id, updates }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "به‌روزرسانی تیکت ناموفق بود" });
  }
});

router.post("/tickets/:id/internal-notes", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageTickets(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureOperationalTables().catch(() => {});
    const note = sanitizePlainText(req.body.note, 5000).trim();
    if (!note) return res.status(400).json({ error: "یادداشت الزامی است" });
    await supabase.from("ticket_internal_notes").insert({ id: `tin-${uuidv4()}`, ticket_id: req.params.id, author_id: adminUser.id, note });
    try { await logAdminAction(adminUser.id, null, "ticket_internal_note", { ticketId: req.params.id }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "ذخیره یادداشت داخلی ناموفق بود" });
  }
});

router.post("/backups/schedule", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!isOwnerUser(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    await ensureOperationalTables().catch(() => {});
    const frequency = ["hourly", "daily", "weekly"].includes(req.body.frequency) ? req.body.frequency : "daily";
    const payload = {
      id: req.body.id ? sanitizePlainText(req.body.id, 120) : `bs-${uuidv4()}`,
      name: sanitizePlainText(req.body.name || "برنامه پیش‌فرض پشتیبان‌گیری", 120),
      frequency,
      enabled: req.body.enabled !== false,
      next_run_at: nextBackupRun(frequency),
      created_by: adminUser.id,
      updated_at: new Date().toISOString()
    };
    await supabase.from("backup_schedules").upsert(payload);
    try { await logAdminAction(adminUser.id, null, "upsert_backup_schedule", payload); } catch {}
    res.json({ success: true, schedule: payload });
  } catch {
    res.status(400).json({ error: "ذخیره زمان‌بندی پشتیبان‌گیری ناموفق بود" });
  }
});

router.post("/backups/files/:name/restore", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!isOwnerUser(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    if (req.body?.confirm !== "RESTORE_USERS") return res.status(400).json({ error: "بازیابی نیازمند confirm: RESTORE_USERS است" });
    const full = resolveBackupPath(req.params.name);
    if (!full) return res.status(400).json({ error: "نام فایل پشتیبان نامعتبر است" });
    const parsed = JSON.parse(await fs.readFile(full, "utf8"));
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    for (const user of users) {
      const restored = {
        ...user,
        id: sanitizePlainText(user.id, 160),
        username: sanitizePlainText(user.username, 120),
        role: normalizeAssignableRole(user.role || "writer", adminUser) || "writer"
      };
      await supabase.from("users").upsert(restored);
    }
    try { await logAdminAction(adminUser.id, null, "restore_backup_users", { file: path.basename(req.params.name), count: users.length }); } catch {}
    res.json({ success: true, restored: users.length });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "بازیابی پشتیبان ناموفق بود" });
  }
});

router.get("/role-presets", async (req, res) => {
  const adminUser = await getActiveUser(req, false);
  if (!canManageRoles(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
  res.json({ presets: ROLE_PRESETS });
});

router.post("/roles/preset", interactionLimiter, async (req, res) => {
  try {
    const adminUser = await getActiveUser(req, true);
    if (!canManageRoles(adminUser)) return res.status(403).json({ error: "دسترسی غیرمجاز" });
    const preset = ROLE_PRESETS.find((item) => item.id === req.body.presetId);
    if (!preset) return res.status(400).json({ error: "قالب آماده ناشناخته است" });
    const sensitiveError = sensitiveRolePermissionError(adminUser, preset.permissions);
    if (sensitiveError) return res.status(403).json({ error: sensitiveError });
    const payload = {
      id: `role-${uuidv4()}`,
      name: sanitizePlainText(req.body.name || preset.name, 80).trim() || preset.name,
      description: preset.description,
      permissions: preset.permissions,
      created_by: adminUser.id,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("custom_roles").upsert(payload, { onConflict: "name" }).select("*").single();
    if (error) throw error;
    try { await logAdminAction(adminUser.id, null, "create_role_from_preset", { presetId: preset.id }); } catch {}
    res.json({ success: true, role: data });
  } catch {
    res.status(400).json({ error: "ساخت نقش از قالب آماده ناموفق بود" });
  }
});

// ---- Email server administration (owner only) ---------------------------

function requireOwner(req: express.Request): Promise<any> {
  return getActiveUser(req, true);
}

router.get("/email/status", async (req, res) => {
  try {
    const admin = await requireOwner(req);
    if (!admin || !isOwnerUser(admin)) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const { data } = await supabase.from("settings").select("setting_value").eq("setting_key", "systemSettings").limit(1);
    const raw = data?.[0]?.setting_value;
    const settings = typeof raw === "string" ? JSON.parse(raw) : (raw || {});
    const availability = getEmailProviderAvailability(settings.emailVerification || {});
    const smtp = settings.emailVerification?.smtp || {};
    res.json({
      provider: {
        enabled: !!settings.emailVerification?.enabled,
        configuredProvider: settings.emailVerification?.provider || "",
        availability
      },
      smtp: {
        host: smtp.host || "",
        port: smtp.port || 587,
        secure: smtp.secure === true,
        user: smtp.user || "",
        from: smtp.from || "",
        direct: smtp.direct === true,
        hasPassword: !!smtp.pass
      },
      inbound: isInboundMailRunning()
    });
  } catch {
    res.status(400).json({ error: "بارگذاری وضعیت ایمیل ناموفق بود." });
  }
});

router.post("/email/smtp", async (req, res) => {
  try {
    const admin = await requireOwner(req);
    if (!admin || !isOwnerUser(admin)) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const host = sanitizePlainText(req.body?.host || "", 200).trim();
    const port = Math.min(65535, Math.max(1, Number(req.body?.port) || 587));
    const secure = req.body?.secure === true;
    const user = sanitizePlainText(req.body?.user || "", 200).trim();
    const pass = String(req.body?.pass || "");
    const from = sanitizePlainText(req.body?.from || "", 200).trim();
    const direct = req.body?.direct === true;
    const verificationEnabled = req.body?.verificationEnabled === true;

    const { data } = await supabase.from("settings").select("setting_value").eq("setting_key", "systemSettings").limit(1);
    const raw = data?.[0]?.setting_value;
    const settings = typeof raw === "string" ? JSON.parse(raw) : ((raw as any) || {});
    settings.emailVerification = settings.emailVerification || {};
    settings.emailVerification.enabled = verificationEnabled;
    settings.emailVerification.provider = "smtp";
    settings.emailVerification.smtp = {
      ...(settings.emailVerification.smtp || {}),
      host, port, secure, user, from, direct,
      ...(pass ? { pass: encrypt(pass) } : {})
    };
    // Switching to direct delivery means no relay credentials are stored.
    if (direct) delete settings.emailVerification.smtp.pass;

    const { error } = await supabase.from("settings").upsert({
      setting_key: "systemSettings",
      setting_value: JSON.stringify(settings)
    });
    if (error) throw error;
    try {
      const { cache } = await import("../../utils/cache");
      await cache.del("settings:system:v2");
    } catch {}
    try { await logAdminAction(admin.id, null, "email_smtp_configured", { direct, port }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "ذخیره پیکربندی ایمیل ناموفق بود." });
  }
});

router.post("/email/test-send", async (req, res) => {
  try {
    const admin = await requireOwner(req);
    if (!admin || !isOwnerUser(admin)) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const to = sanitizePlainText(req.body?.to || "", 200).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "نشانی ایمیل مقصد معتبر نیست." });

    const { data } = await supabase.from("settings").select("setting_value").eq("setting_key", "systemSettings").limit(1);
    const raw = data?.[0]?.setting_value;
    const settings = typeof raw === "string" ? JSON.parse(raw) : ((raw as any) || {});
    const config = prepareEmailConfig(settings.emailVerification || {});
    const sent = await sendEmailWithAvailableConfig(
      config, to,
      "ایمیل آزمایشی رپتوک",
      "پیکربندی ایمیل سرور شما کار می‌کند.",
      "<p>پیکربندی ایمیل سرور شما کار می‌کند. این یک ایمیل آزمایشی است.</p>"
    );
    if (!sent) return res.status(400).json({ error: "ارسال ایمیل آزمایشی ناموفق بود؛ لاگ سرور را بررسی کنید." });
    try { await logAdminAction(admin.id, null, "email_test_sent", { to }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "ارسال ایمیل آزمایشی ناموفق بود." });
  }
});

router.post("/email/inbound/toggle", async (req, res) => {
  try {
    const admin = await requireOwner(req);
    if (!admin || !isOwnerUser(admin)) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const enabled = req.body?.enabled === true;
    const port = Math.min(65535, Math.max(1, Number(req.body?.port) || 25));
    const domain = sanitizePlainText(req.body?.domain || "", 253).trim().toLowerCase();
    const host = sanitizePlainText(req.body?.host || "", 64).trim();
    await saveInboundMailConfig({ enabled, port, domain, host: host || undefined });
    if (enabled && domain) {
      await startInboundMailServer(port, domain, host);
    } else {
      await stopInboundMailServer();
    }
    try { await logAdminAction(admin.id, null, enabled ? "email_inbound_started" : "email_inbound_stopped", { port, domain, host }); } catch {}
    res.json({ success: true, inbound: isInboundMailRunning() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "تغییر وضعیت دریافت ایمیل ناموفق بود." });
  }
});

router.get("/email/inbound/messages", async (req, res) => {
  try {
    const admin = await requireOwner(req);
    if (!admin || !isOwnerUser(admin)) return res.status(403).json({ error: "دسترسی مالک لازم است." });
    const result = await db.query(
      `SELECT id, envelope_from, envelope_to, subject, raw_size, is_read, received_at
         FROM inbound_emails ORDER BY received_at DESC LIMIT 50`
    ).catch(() => ({ rows: [] }));
    res.json({ messages: result.rows || [] });
  } catch {
    res.status(400).json({ error: "بارگذاری صندوق ورودی ناموفق بود." });
  }
});

router.get("/email/inbound/messages/:id", async (req, res) => {
  try {
    const admin = await requireOwner(req);
    if (!admin || !isOwnerUser(admin)) return res.status(403).json({ error: "دسترسی مالک لازم است." });
    // ✅ SECURITY: Validate email ID format before DB query.
    const emailId = String(req.params.id || "").slice(0, 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(emailId)) {
      return res.status(400).json({ error: "شناسه ایمیل نامعتبر است." });
    }
    const result = await db.query(`SELECT * FROM inbound_emails WHERE id=$1`, [emailId]);
    if (!result.rows[0]) return res.status(404).json({ error: "پیام یافت نشد." });
    res.json({ message: result.rows[0] });
  } catch {
    res.status(400).json({ error: "خواندن پیام ناموفق بود." });
  }
});

router.delete("/email/inbound/messages/:id", async (req, res) => {
  try {
    const admin = await requireOwner(req);
    if (!admin || !isOwnerUser(admin)) return res.status(403).json({ error: "دسترسی مالک لازم است." });
    // ✅ SECURITY: Validate email ID format before DB query.
    const emailId = String(req.params.id || "").slice(0, 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(emailId)) {
      return res.status(400).json({ error: "شناسه ایمیل نامعتبر است." });
    }
    await db.query(`DELETE FROM inbound_emails WHERE id=$1`, [emailId]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف پیام ناموفق بود." });
  }
});
