import express from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { db, supabase } from "../postgres";
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from "express-rate-limit";
import sanitizeHtml from "sanitize-html";
import fs from "fs";
import path from "path";
// import RedisStore from "rate-limit-redis";

import forumsRouter from "./routes/forums";
import achievementsRouter from "./routes/achievements";
import notificationsRouter from "./routes/notifications";
import supportRouter from "./routes/support";
import uploadRouter from "./routes/upload";
import suggestionRouter from "./routes/suggestion";
import editorRouter from "./routes/editor";
import postsRouter from "./routes/posts";
import analyticsRouter from "./routes/analytics";
import adminRouter from "./routes/admin";
import aiRouter from "./routes/ai";
import messagesRouter from "./routes/messages";
import contestsRouter from "./routes/contests";
import eventsRouter from "./routes/events";
import challengesRouter from "./routes/challenges";
import monitoringRouter from "./routes/monitoring";
import exchangeRouter from "./routes/exchange";
import premiumManagementRouter from "./routes/premiumManagement";
import worldbuildingRouter from "./routes/worldbuilding";
import mangaRouter from "./routes/manga";
import { globalLimiter, sensitiveLimiter, uploadLimiter, authLimiter, authIpLimiter, interactionLimiter, otpLimiter, passwordResetRequestLimiter, passwordResetConfirmLimiter } from "./limiters";
import { invalidateSuggestionPreferences, recordSuggestionStatsEvent, syncSuggestionNovelArtifacts, syncSuggestionNovelArtifactsFromDb } from "../suggestion/maintenance";
import { catalogCacheKey, invalidateNovelCaches, novelCacheKey, sharedCache } from "../utils/catalogCache";
import { applyPremiumAction, getActiveWriterPremiumUserIds, getEffectiveEntitlements, hasWriterPremium } from "../utils/premiumEntitlements";
import { calculateAverageViews } from "../../shared/statistics";
import {
  assertPricingMatchesStripeAmount,
  normalizePremiumDuration,
  normalizePremiumPlanType,
  quotePremium,
} from "../../shared/premiumPricing";
import { sanitizePremiumPresentation } from "../../shared/premiumTemplates";
import { loadParagraphsForChapters, syncChapterParagraphs } from "../utils/paragraphs";
import { MangaPageError, loadChapterPages, loadPagesForChapters, replaceChapterPages } from "../utils/manga";
import { normalizeContentKind, normalizeReadingDirection } from "../../shared/manga";
import { currentActivityStreak, recordDailyActivityStreak } from "../utils/userActivity";
import { moderateNewComment } from "../utils/commentModeration";

const router = express.Router();
const DEFAULT_FROM_EMAIL = "noreply@reptoc.xyz";
const DEFAULT_FROM_NAME = "رپتوک";
function normalizeBookmarkCategories(categories: any[]) {
  const raw = Array.isArray(categories) ? categories : [];
  return raw
    .map((category: any, index: number) => {
      const items = Array.isArray(category?.items) ? category.items : Array.isArray(category?.ids) ? category.ids : [];
      const id = sanitizePlainText(typeof category?.id === "string" && category.id ? category.id : "", 120) || `cat-${index + 1}`;
      const name = sanitizePlainText(typeof category?.name === "string" ? category.name : "", 80).trim() || `Category ${index + 1}`;
      return {
        id,
        name,
        items: (items as any[]).map((item: any) => sanitizePlainText(String(item), 160)).filter(Boolean)
      };
    })
    .filter((category: any) => !!category.name);
}

const defaultAllowedOrigins = [
  "https://demo.reptoc.xyz",
  "https://reptoc.xyz",
  "https://www.reptoc.xyz",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:3000",
  "https://localhost:3000"
];

const allowedOrigins = Array.from(new Set([
  ...defaultAllowedOrigins,
  ...(process.env.CORS_ORIGIN || "").split(","),
  ...(process.env.ALLOWED_ORIGINS || "").split(",")
].map((origin) => origin.trim()).filter(Boolean)));

// Cookies must be marked Secure whenever the deployment is production OR the
// configured public origin is HTTPS — even if NODE_ENV is forgotten at boot.
// ✅ SECURITY: Default to secure cookies. Only disable when explicitly allowed.
// Previously, forgetting to set NODE_ENV or APP_URL would silently ship
// non-secure cookies over HTTP, allowing session hijacking on MitM.
const secureCookiesEnabled =
  process.env.DISABLE_SECURE_COOKIES !== "true"
  && (
    process.env.NODE_ENV === "production"
    || String(process.env.APP_URL || "").trim().toLowerCase().startsWith("https://")
  );
// If user explicitly opted out, warn loudly.
if (process.env.DISABLE_SECURE_COOKIES === "true" && process.env.NODE_ENV === "production") {
  console.warn("[security] DISABLE_SECURE_COOKIES=true in production! Session cookies will be sent over HTTP.");
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // ✅ SECURITY: Same-origin requests (no Origin header) are still allowed
    // by the browser, but we do not return `Access-Control-Allow-Origin`
    // for them. This prevents server-to-server credential-bearing requests
    // from receiving CORS headers they could abuse.
    if (!origin) return callback(null, false);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Origin not allowed"));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400,
};

router.use(cors(corsOptions));
router.use(helmet({
  originAgentCluster: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      // API responses are JSON; no third-party script or frame origin is
      // needed here. Google advertising was retired platform-wide.
      scriptSrc: ["'self'"],
      frameSrc: ["'self'"],
      connectSrc: ["'self'", "https:", "http:", "ws:", "wss:"],
      fontSrc: ["'self'", "https:", "data:", "https://fonts.gstatic.com"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },  // ✅ Enable HSTS
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
}));

router.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Novel creation can include a compressed cover data URL and opening chapter.
// Keep a finite cap, but allow normal authoring payloads above Express' old 1 MB limit.
router.use(express.json({ limit: '10mb' }));
router.use(express.urlencoded({ extended: true, limit: '10mb' }));
router.use(globalLimiter);

// Final safety net: every successful write routed through a novel URL evicts
// catalogue/detail/recommendation data, including writes in mounted routers.
router.use((req, res, next) => {
  const mutates = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (mutates && /(?:^|\/)novels(?:\/|$)/.test(req.path)) {
    const match = req.path.match(/\/novels\/([^/]+)/);
    const novelId = match && !["bulk", "search"].includes(match[1]) ? decodeURIComponent(match[1]) : undefined;
    res.on("finish", () => {
      if (res.statusCode < 400) void invalidateCache("novels", novelId);
    });
  }
  next();
});

// Monitoring router
router.use('/monitor', monitoringRouter);

async function invalidateCache(_keyPrefix: string, novelId?: string) {
  try {
    await invalidateNovelCaches(novelId);
  } catch (error: any) {
    console.warn("Failed to invalidate novel caches:", error?.message || error);
  }
}

async function syncNovelLikeTotals(novelId: string, queryable: any = db) {
  const counts = (await queryable.query(
    `SELECT
       (SELECT count(*)::int FROM novel_likes WHERE novel_id=$1) AS novel_likes,
       (SELECT count(*)::int FROM chapter_likes WHERE novel_id=$1) AS chapter_likes`,
    [novelId],
  )).rows[0] || {};
  const novelLikes = Number(counts.novel_likes || 0);
  const chapterLikes = Number(counts.chapter_likes || 0);
  const totalLikes = novelLikes + chapterLikes;
  await queryable.query("UPDATE novels SET likes_count=$2 WHERE id=$1", [novelId, totalLikes]);
  await queryable.query("UPDATE suggestion_novel_stats SET likes=$2, updated_at=now() WHERE novel_id=$1", [novelId, totalLikes]);
  return { novelLikes, chapterLikes, totalLikes };
}

function catalogueCoverUrl(novel: any): string {
  const cover = String(novel?.cover_url || "");
  return cover.startsWith("data:image/")
    ? `/api/novels/${encodeURIComponent(String(novel.id))}/cover`
    : cover;
}

/**
 * Determines if a novel should be visible to public users (non-moderators).
 * Only novels with explicit 'approved' status are considered public.
 * Null or pending_approval statuses are treated as private/unapproved.
 */
/**
 * Ensures novel author information is correctly populated from the users table
 * Call this before returning novel data to ensure consistency
 */
async function enrichNovelWithAuthorInfo(novel: any): Promise<any> {
  if (!novel) return novel;
  
  // Preserve the novel's public pen name. Only backfill legacy rows where it is missing.
  if (novel.author_id && !String(novel.author || "").trim()) {
    try {
      const { data: authorData } = await supabase
        .from('users')
        .select('username')
        .eq('id', novel.author_id)
        .single();
      
      if (authorData?.username) {
        novel.author = authorData.username;
      }
    } catch (err) {
      console.error(`Failed to hydrate author info for novel ${novel.id}:`, err);
      // Continue with existing author name if hydration fails
    }
  }
  
  return novel;
}

import { getActiveUser, enforceAdmin, requireVerifiedEmailForWriting, hashSessionToken, requireUserWithCsrf } from "../utils/auth";
import * as UAParser from "ua-parser-js";
import crypto from "crypto";
import { encrypt, decrypt, isEncryptedValue } from "../utils/encryption";
import { schemas, validate } from "../utils/validation";
import { z } from "zod";
import { logSecurityEvent, SecurityEventType } from "../utils/security-logger";
import { countWordsFromHtml, sanitizeStoryHtml } from "../utils/content";
import {
  checkUploadQuota,
  extractStoredImageReferences,
  releaseUnreferencedNovelFiles,
  resolveStoredImageFileIds,
  unlinkStoredUpload,
} from "../utils/mediaLifecycle";
import { canManageNovel, canUserViewNovel, isChapterVisibleToUser, publishDueScheduledChapters, saveChapterVersion } from "../utils/chapters";
import { sendDiscordChapterPublishedAnnouncement } from "../utils/discord";
import { validateNovelTaxonomy } from "../utils/taxonomy";
import { sanitizeSystemSettingsTaxonomy, sanitizeTaxonomyList } from "../utils/taxonomyFilters";
import { createUserNotification, ensureNotificationTable, notifyChapterPublishedAudience } from "../utils/notifications";
import { checkAndAwardAchievement, evaluateAndAwardUserAchievements, incrementUserCounter } from "../utils/achievements";
import { buildAnalyticsContext } from "../utils/analyticsContext";
import { ensureAnalyticsTables } from "../utils/analyticsSchema";
import { hasCountedChapterView, recordNovelUniqueView } from "../utils/viewCounting";
import { ensureOperationalTables } from "../utils/operations";
import { deleteNovelCompletely } from "../utils/novelDeletion";
import { filterExistingColumns, filterPayloadToExistingColumns, isSchemaPermissionError, reportSchemaGapOnce, runOptionalSchemaQueries } from "../utils/dbSchema";
import { normalizeStoredImageReference } from "../utils/images";
import {
  changeUsername,
  isUsernameUnavailable,
  resolveUsername,
  userAchievementSettingsKey,
  userChapterNoteKey,
  userPreferencesKey,
  userStatsKey,
  usernameChangeAvailableAt,
  UsernameChangeError,
  validateUsername,
} from "../utils/usernames";

function sanitizePlainText(value: unknown, max = 5000): string {
  return sanitizeHtml(String(value || ""), { allowedTags: [], allowedAttributes: {} }).slice(0, max);
}

function sanitizeCharacterImageUrl(value: unknown): string {
  return normalizeStoredImageReference(sanitizePlainText(value, 2000), { allowEmpty: true });
}

function sanitizeCharacters(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((character: any, index: number) => ({
    id: sanitizePlainText(character?.id || `character-${index + 1}`, 100),
    name: sanitizePlainText(character?.name, 120).trim(),
    role: sanitizePlainText(character?.role || "شخصیت فرعی", 120).trim(),
    bio: sanitizePlainText(character?.bio || "", 2000).trim(),
    imageUrl: sanitizeCharacterImageUrl(character?.imageUrl) || undefined,
  })).filter((character: any) => character.name);
}

const CHARACTER_VOTES_PER_DAY = 3;

async function loadCharacterVoteSummary(novelId: string, userId?: string | null, queryable: any = db) {
  const totalsResult = await queryable.query(
    `SELECT character_id, count(*)::int AS votes_count
       FROM character_votes
      WHERE novel_id=$1
      GROUP BY character_id`,
    [novelId],
  );
  let votedCharacterIds: string[] = [];
  let votesUsedToday = 0;
  if (userId) {
    const viewerResult = await queryable.query(
      `SELECT character_id
         FROM character_votes
        WHERE novel_id=$1 AND user_id=$2`,
      [novelId, userId],
    );
    votedCharacterIds = viewerResult.rows.map((row: any) => String(row.character_id));
    const dailyResult = await queryable.query(
      `SELECT count(*)::int AS votes_used
         FROM character_votes
        WHERE user_id=$1
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [userId],
    );
    votesUsedToday = Number(dailyResult.rows[0]?.votes_used || 0);
  }
  return {
    votes: Object.fromEntries(totalsResult.rows.map((row: any) => [String(row.character_id), Number(row.votes_count || 0)])),
    votedCharacterIds,
    votesUsedToday,
    votesRemainingToday: Math.max(0, CHARACTER_VOTES_PER_DAY - votesUsedToday),
  };
}

function buildPublicUserIdentity(profile: any = {}, fallback: any = {}) {
  const username = sanitizePlainText(profile.username || fallback.username || "", 80).trim();
  const nickname = sanitizePlainText(profile.nickname || fallback.nickname || fallback.displayName || "", 80).trim();
  const avatar = sanitizePlainText(profile.avatar || fallback.avatar || "", 500).trim();
  return {
    userId: sanitizePlainText(profile.id || fallback.user_id || fallback.userId || "", 120).trim() || null,
    username,
    displayName: nickname || username || "خواننده",
    avatar,
    role: sanitizePlainText(profile.role || fallback.role || "", 40).trim() || "reader"
  };
}

async function loadPublicUsers(column: "id" | "username", values: string[]) {
  const cleanValues = Array.from(new Set(values.map((value) => sanitizePlainText(value, 120).trim()).filter(Boolean)));
  if (cleanValues.length === 0) return [];
  const userColumns = await filterExistingColumns("users", ["id", "username", "nickname", "avatar", "role"]);
  const selectColumns = userColumns.length ? userColumns.join(", ") : "id, username";
  const primary = await supabase
    .from("users")
    .select(selectColumns)
    .in(column, cleanValues);
  if (!primary.error && Array.isArray(primary.data)) return primary.data;

  const fallback = await supabase
    .from("users")
    .select("id, username")
    .in(column, cleanValues);
  return !fallback.error && Array.isArray(fallback.data) ? fallback.data : [];
}

async function hydrateReviewIdentities(reviews: any[]) {
  if (!Array.isArray(reviews) || reviews.length === 0) return [];
  try {
    const userIds = reviews.map((review) => String(review.user_id || "").trim()).filter(Boolean);
    const usersById = await loadPublicUsers("id", userIds);
    const idMap = new Map(usersById.map((profile: any) => [String(profile.id), profile]));
    return reviews.map((review) => ({
      ...review,
      __publicUser: buildPublicUserIdentity(
        idMap.get(String(review.user_id || "")) || {},
        review
      )
    }));
  } catch {
    return reviews.map((review) => ({
      ...review,
      __publicUser: buildPublicUserIdentity({}, review)
    }));
  }
}

async function buildNovelAuthorIdentityMaps(novels: any[]) {
  const byId = new Map<string, any>();
  const authorIds = (novels || []).map((novel) => String(novel.author_id || "").trim()).filter(Boolean);
  const usersById = await loadPublicUsers("id", authorIds);
  usersById.forEach((profile: any) => byId.set(String(profile.id), buildPublicUserIdentity(profile, profile)));
  return { byId };
}

function getNovelAuthorIdentity(novel: any, maps: { byId: Map<string, any> }) {
  return maps.byId.get(String(novel.author_id || ""))
    || buildPublicUserIdentity({}, { username: novel.author, user_id: novel.author_id });
}

function ratingForReviewCount(rating: any, reviewCount: any) {
  return Number(reviewCount || 0) > 0 ? Number(rating || 0) : 0;
}

function mapReviewToClient(review: any) {
  const identity = review.__publicUser || buildPublicUserIdentity(review.users || {}, review);
  return {
    id: review.id,
    userId: identity.userId || review.user_id || null,
    username: identity.username || review.username,
    displayName: identity.displayName || identity.username || review.username || "خواننده",
    avatar: identity.avatar || "",
    role: identity.role || "reader",
    rating: review.rating,
    ratingOverall: review.rating_overall || review.rating,
    ratingStyle: review.rating_style || review.rating,
    ratingStory: review.rating_story || review.rating,
    ratingGrammar: review.rating_grammar || review.rating,
    ratingCharacter: review.rating_character || review.rating,
    comment: review.content || review.comment || "",
    createdAt: review.created_at || review.createdAt || new Date().toISOString()
  };
}

function mapSocialProfile(profile: any, followed = false) {
  const identity = buildPublicUserIdentity(profile, profile);
  return {
    id: identity.userId || profile.id,
    username: identity.username || profile.username,
    displayName: identity.displayName || profile.username,
    avatar: identity.avatar || "",
    role: identity.role || profile.role || "writer",
    followed
  };
}

async function buildSocialPayload(user: any) {
  const [followingRowsResult, followerRowsResult, blockedResult] = await Promise.all([
    supabase.from('follows').select('target_id').eq('follower_id', user.id).eq('target_type', 'user'),
    supabase.from('follows').select('follower_id').eq('target_id', user.id).eq('target_type', 'user'),
    supabase.from('blocked_users').select('blocked_user_id').eq('blocker_user_id', user.id)
  ]);
  const followingIds = new Set<string>((followingRowsResult.data || []).map((row: any) => String(row.target_id)).filter(Boolean));
  const followerIds = new Set<string>((followerRowsResult.data || []).map((row: any) => String(row.follower_id)).filter(Boolean));
  const blockedIds = new Set<string>((blockedResult.data || []).map((row: any) => String(row.blocked_user_id)).filter(Boolean));
  const allProfileIds = Array.from(new Set<string>([...followingIds, ...followerIds, ...blockedIds])).filter((id) => id && id !== user.id);
  const profiles = await loadPublicUsers("id", allProfileIds);
  const profileMap = new Map(profiles.map((profile: any) => [String(profile.id), profile]));
  const followers = Array.from(followerIds)
    .filter((id) => id !== user.id)
    .map((id) => profileMap.get(id))
    .filter((profile): profile is any => Boolean(profile))
    .map((profile) => mapSocialProfile(profile, followingIds.has(String(profile.id))));
  const following = Array.from(followingIds)
    .filter((id) => id !== user.id)
    .map((id) => profileMap.get(id))
    .filter((profile): profile is any => Boolean(profile))
    .map((profile) => mapSocialProfile(profile, true));
  const blockedUsers = Array.from(blockedIds)
    .map((id) => profileMap.get(id)?.username)
    .filter(Boolean);
  return {
    followers,
    following,
    blockedUsers
  };
}

function normalizeFacet(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function novelMatchesFacet(novel: any, facet: string): boolean {
  const target = normalizeFacet(facet);
  if (!target) return true;
  const values = [
    novel.genre,
    ...sanitizeTaxonomyList(Array.isArray(novel.main_categories) ? novel.main_categories : [])
  ];
  return values.some((value) => normalizeFacet(value) === target);
}

function searchTokens(value: unknown): string[] {
  return normalizeFacet(value).split(" ").filter(Boolean);
}

function editDistanceAtMost(a: string, b: string, maxDistance: number): boolean {
  if (Math.abs(a.length - b.length) > maxDistance) return false;
  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  const current = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return false;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length] <= maxDistance;
}

function scoreSearchField(value: unknown, query: string, tokens: string[], weight: number): number {
  const field = normalizeFacet(value);
  if (!field) return 0;
  const fieldTokens = searchTokens(field);
  let score = 0;

  if (field === query) score += weight * 12;
  if (field.startsWith(query)) score += weight * 7;
  if (field.includes(query)) score += weight * 4;

  for (const token of tokens) {
    if (fieldTokens.includes(token)) score += weight * 2.4;
    else if (fieldTokens.some((fieldToken) => fieldToken.startsWith(token))) score += weight * 1.6;
    else if (field.includes(token)) score += weight;
    else if (token.length >= 4 && fieldTokens.some((fieldToken) => editDistanceAtMost(token, fieldToken, token.length > 7 ? 2 : 1))) {
      score += weight * 0.8;
    }
  }

  if (tokens.length > 1 && tokens.every((token) => field.includes(token))) score += weight * 2;
  return score;
}

function scoreNovelSearch(novel: any, query: string, tokens: string[]): number {
  if (!query || tokens.length === 0) return 0;
  const categoryText = sanitizeTaxonomyList([
    novel.genre,
    ...(Array.isArray(novel.main_categories) ? novel.main_categories : []),
    ...(Array.isArray(novel.sub_categories) ? novel.sub_categories : []),
    ...(Array.isArray(novel.tags) ? novel.tags : [])
  ]).join(" ");

  let relevance = 0;
  relevance += scoreSearchField(novel.title, query, tokens, 120);
  relevance += scoreSearchField(novel.author, query, tokens, 105);
  relevance += scoreSearchField(categoryText, query, tokens, 28);
  relevance += scoreSearchField(novel.description, query, tokens, 12);
  relevance += Math.min(20, Number(novel.rating || 0) * 3);
  relevance += Math.min(15, Math.log1p(Number(novel.views_count || 0)));
  return relevance;
}

function normalizeChapterSubmissionStatus(value: unknown, _isEditorialStaff = false) {
  const raw = String(value || "Draft").trim().toLowerCase().replace(/\s+/g, "_");
  const now = new Date().toISOString();
  // Novel creation is the only editorial approval gate. Once an author owns a
  // novel, its chapters may be kept private, published now, or scheduled.
  if (raw === "published" || raw === "publish" || raw === "submitted") {
    return { status: "Published", editorial_status: "published", approved_at: now, published_at: now };
  }
  if (raw === "scheduled") return { status: "Scheduled", editorial_status: "scheduled", approved_at: now };
  if (raw === "approved") return { status: "Draft", editorial_status: "approved", approved_at: now };
  if (raw === "needs_changes") return { status: "Draft", editorial_status: "needs_changes" };
  return { status: "Draft", editorial_status: "draft" };
}

function normalizeChapterIdSegment(value: unknown) {
  return sanitizePlainText(value, 120)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "novel";
}

function buildNovelScopedChapterId(novelId: string, chapterNumber: number) {
  const safeNumber = Math.max(1, Number(chapterNumber) || 1);
  return `chap-${normalizeChapterIdSegment(novelId)}-${safeNumber}-${uuidv4().slice(0, 8)}`;
}

const CHAPTER_CATALOG_COLUMNS = [
  "id", "novel_id", "title", "status", "editorial_status", "moderation_status", "scheduled_at",
  "published_at", "chapter_number", "is_auxiliary", "word_count", "page_count", "views_count",
  "prevent_copy", "prevent_screenshot", "order_index", "created_at", "updated_at",
];

const CHAPTER_FULL_COLUMNS = [
  "id", "novel_id", "title", "content", "author_notes_top", "author_notes_bottom", "status",
  "editorial_status", "moderation_status", "assigned_editor_id", "review_due_at", "submitted_at",
  "approved_at", "approved_by", "scheduled_at", "published_at", "chapter_number", "is_auxiliary",
  "word_count", "page_count", "views_count", "prevent_copy", "prevent_screenshot", "order_index", "editor_note", "created_at", "updated_at",
];

/**
 * Chapter columns to read, narrowed to the ones this database actually has.
 *
 * `page_count` (manga) arrives with migration 076. Selecting a column that does
 * not exist yet fails the whole catalogue with 42703, so the list is filtered
 * against the live schema; the result is served from a cached column set.
 */
async function chapterSelectColumns(variant: "catalog" | "full"): Promise<string> {
  const requested = variant === "catalog" ? CHAPTER_CATALOG_COLUMNS : CHAPTER_FULL_COLUMNS;
  const available = await filterExistingColumns("chapters", requested);
  return (available.length ? available : requested).join(", ");
}

async function resolveChapterIdentity(novelId: string, requestedId: unknown, chapterNumber: number, isAuxiliary = false) {
  const cleanRequestedId = sanitizePlainText(requestedId, 180).trim();
  const { data: sameNumberChapter } = await supabase
    .from("chapters")
    .select("*")
    .eq("novel_id", novelId)
    .eq("chapter_number", chapterNumber)
    .eq("is_auxiliary", isAuxiliary)
    .single();

  if (cleanRequestedId) {
    const { data: chapterWithRequestedId } = await supabase
      .from("chapters")
      .select("*")
      .eq("id", cleanRequestedId)
      .single();

    if (chapterWithRequestedId?.novel_id && chapterWithRequestedId.novel_id !== novelId) {
      throw new Error("شناسه فصل متعلق به رمان دیگری است.");
    }

    if (chapterWithRequestedId?.novel_id === novelId) {
      if (sameNumberChapter && sameNumberChapter.id !== chapterWithRequestedId.id) {
        throw new Error(`فصل ${chapterNumber} از قبل برای این رمان وجود دارد.`);
      }
      return { chapterId: chapterWithRequestedId.id, existingChapter: chapterWithRequestedId };
    }

    if (sameNumberChapter) {
      return { chapterId: sameNumberChapter.id, existingChapter: sameNumberChapter };
    }
    return { chapterId: cleanRequestedId, existingChapter: null };
  }

  if (sameNumberChapter) {
    return { chapterId: sameNumberChapter.id, existingChapter: sameNumberChapter };
  }

  const generatedId = buildNovelScopedChapterId(novelId, chapterNumber);
  return { chapterId: generatedId, existingChapter: null };
}

async function readSystemSettings(): Promise<any> {
  const cached = await sharedCache.get<any>("settings:system:v2");
  if (cached) return cached;
  let result = await supabase.from('settings').select('setting_value').eq('setting_key', 'systemSettings').single();
  if (result.error?.code === "42P01" || /does not exist/i.test(String(result.error?.message || ""))) {
    await ensureSettingsTable();
    return {};
  }
  const { data: settingsEntry } = result;
  if (!settingsEntry?.setting_value) return {};
  try {
    const parsed = typeof settingsEntry.setting_value === 'string' ? JSON.parse(settingsEntry.setting_value) : settingsEntry.setting_value;
    const settings = sanitizeSystemSettingsTaxonomy(parsed);
    await sharedCache.set("settings:system:v2", settings, 5 * 60);
    return settings;
  } catch {
    return {};
  }
}

function redactPublicSettings(settings: any, isAdmin: boolean) {
  const cloned = sanitizeSystemSettingsTaxonomy(settings || {});
  if (!isAdmin) {
    for (const key of Object.keys(cloned)) {
      if (key.startsWith("ad_")) delete cloned[key];
    }
  }
  if (!isAdmin && cloned.emailVerification) {
    cloned.emailVerification = {
      enabled: !!cloned.emailVerification.enabled,
      provider: cloned.emailVerification.provider || process.env.EMAIL_PROVIDER,
      from: cloned.emailVerification.resend?.from || cloned.emailVerification.smtp?.from || cloned.emailVerification.mailjet?.from || process.env.RESEND_FROM_EMAIL || process.env.FROM_EMAIL || process.env.MAILJET_FROM_EMAIL || DEFAULT_FROM_EMAIL
    };
  } else if (isAdmin && cloned.emailVerification) {
    cloned.emailVerification = {
      ...cloned.emailVerification,
      smtp: cloned.emailVerification.smtp ? { ...cloned.emailVerification.smtp, pass: "" } : undefined,
      mailjet: cloned.emailVerification.mailjet ? { ...cloned.emailVerification.mailjet, apiKey: "", secretKey: "" } : undefined,
      resend: cloned.emailVerification.resend ? { ...cloned.emailVerification.resend, apiKey: "" } : undefined
    };
  }
  return cloned;
}

function decryptIfEncrypted(value: unknown): string {
  if (!value) return "";
  const text = String(value);
  return decrypt(text) || text;
}

function normalizedEmailOrDefault(value: unknown) {
  const text = sanitizePlainText(value, 255).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : (process.env.FROM_EMAIL || process.env.RESEND_FROM_EMAIL || process.env.MAILJET_FROM_EMAIL || DEFAULT_FROM_EMAIL);
}

function normalizedEmailProvider(value: unknown) {
  const provider = sanitizePlainText(value, 32).trim().toLowerCase();
  return provider === "smtp" || provider === "mailjet" || provider === "resend" ? provider : undefined;
}

function prepareEmailConfig(emailVerification: any) {
  const smtp = emailVerification?.smtp || {};
  const mailjet = emailVerification?.mailjet || {};
  const resend = emailVerification?.resend || {};
  const defaultFrom = process.env.FROM_EMAIL || process.env.RESEND_FROM_EMAIL || process.env.MAILJET_FROM_EMAIL || DEFAULT_FROM_EMAIL;
  return {
    provider: normalizedEmailProvider(emailVerification?.provider) || normalizedEmailProvider(process.env.EMAIL_PROVIDER),
    smtp: {
      ...smtp,
      host: smtp.host || process.env.SMTP_HOST,
      port: smtp.port || process.env.SMTP_PORT || 587,
      user: smtp.user || process.env.SMTP_USER,
      pass: decryptIfEncrypted(smtp.pass) || process.env.SMTP_PASS,
      from: normalizedEmailOrDefault(smtp.from || defaultFrom)
    },
    mailjet: {
      ...mailjet,
      apiKey: decryptIfEncrypted(mailjet.apiKey) || process.env.MAILJET_API_KEY,
      secretKey: decryptIfEncrypted(mailjet.secretKey) || process.env.MAILJET_SECRET_KEY,
      from: normalizedEmailOrDefault(mailjet.from || process.env.MAILJET_FROM_EMAIL || defaultFrom),
      fromName: sanitizePlainText(mailjet.fromName || process.env.MAILJET_FROM_NAME || "رپتوک", 120).trim() || "رپتوک"
    },
    resend: {
      ...resend,
      apiKey: decryptIfEncrypted(resend.apiKey) || process.env.RESEND_API_KEY,
      from: normalizedEmailOrDefault(resend.from || process.env.RESEND_FROM_EMAIL || defaultFrom),
      fromName: sanitizePlainText(resend.fromName || process.env.RESEND_FROM_NAME || "رپتوک", 120).trim() || "رپتوک"
    }
  };
}

async function sendVerificationCodeEmail(systemSettings: any, to: string, code: string): Promise<boolean> {
  const { sendEmailWithAvailableConfig } = await import("../utils/email");
  return sendEmailWithAvailableConfig(
    prepareEmailConfig(systemSettings.emailVerification),
    to,
    "کد تأیید رپتوک شما",
    `کد تأیید رپتوک شما ${code} است. این کد پس از 15 دقیقه منقضی می‌شود. آن را با کسی به اشتراک نگذارید.`,
    `<p>کد تأیید رپتوک شما <strong>${code}</strong> است.</p><p>این کد پس از 15 دقیقه منقضی می‌شود.</p><p><strong>این کد را با هیچ‌کس به اشتراک نگذارید.</strong></p>`
  );
}

const PASSWORD_RESET_GENERIC_MESSAGE = "اگر حسابی با این ایمیل موجود باشد، کد بازنشانی رمز عبور برای آن ارسال شده است.";

function normalizeAuthEmail(value: unknown): string {
  return sanitizePlainText(value, 255).trim().toLowerCase();
}

function getResetHashSecret(): string {
  const secret = process.env.PASSWORD_RESET_SECRET || process.env.ENCRYPTION_KEY || "";
  if (secret.length < 32) {
    throw new Error("PASSWORD_RESET_SECRET or ENCRYPTION_KEY must be at least 32 characters.");
  }
  return secret;
}

function hashResetIdentifier(value: unknown): string {
  return crypto
    .createHmac("sha256", getResetHashSecret())
    .update(String(value || "unknown").trim().toLowerCase())
    .digest("hex");
}

function getRequestIpHash(req: express.Request): string {
  return hashResetIdentifier(req.ip || req.socket.remoteAddress || "unknown-ip");
}

function getRequestUserAgentHash(req: express.Request): string {
  return hashResetIdentifier(String(req.headers["user-agent"] || "unknown-agent").slice(0, 500));
}

function generateSixDigitCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function isStrongPassword(value: string): boolean {
  return value.length >= 12 &&
    value.length <= 128 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^a-zA-Z0-9]/.test(value);
}

async function enforceMinimumResponseTime(startedAt: number, minimumMs = 650): Promise<void> {
  const elapsed = Date.now() - startedAt;
  const jitter = crypto.randomInt(25, 125);
  const waitMs = Math.max(0, minimumMs + jitter - elapsed);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}

/**
 * Mirror an engagement notification (comment/review) into the recipient's
 * inbox (messages) so it is visible from the Mail panel with a deep link
 * straight to the content. Failures never break the main request.
 */
async function mirrorToInbox(recipientId: string, senderName: string, subject: string, snippetText: string, link: string) {
  try {
    await supabase.from("messages").insert({
      id: `msg-${uuidv4()}`,
      recipient_id: recipientId,
      sender_id: null,
      username: senderName,
      sender: senderName,
      subject: String(subject).slice(0, 160),
      snippet: String(snippetText || "").slice(0, 500),
      is_read: 0,
      link: String(link || "").slice(0, 500),
      created_at: new Date().toISOString()
    });
  } catch (mirrorError: any) {
    console.error("[inbox-mirror] failed:", { recipientId, message: mirrorError?.message, code: mirrorError?.code });
  }
}

// A real bcrypt digest of an unguessable random value, computed once at boot.
// Compared against when the submitted username does not exist so unknown-user
// and wrong-password logins cost the same CPU time (no timing oracle for
// account existence).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 12);

async function sendPasswordResetCodeEmail(systemSettings: any, to: string, code: string, username = "کاربر"): Promise<boolean> {
  const { sendEmailWithAvailableConfig } = await import("../utils/email");
  const safeName = sanitizePlainText(username, 80).trim() || "کاربر";
  return sendEmailWithAvailableConfig(
    prepareEmailConfig(systemSettings.emailVerification || {}),
    to,
    "کد بازنشانی رمز عبور رپتوک شما",
    `${safeName} عزیز،\n\nکد بازنشانی رمز عبور رپتوک شما ${code} است. این کد پس از 15 دقیقه منقضی می‌شود. آن را با کسی به اشتراک نگذارید. اگر درخواست بازنشانی نداده‌اید، این ایمیل را نادیده بگیرید.`,
    `<p><strong>${safeName}</strong> عزیز،</p><p>کد بازنشانی رمز عبور Reptoc شما <strong>${code}</strong> است.</p><p>این کد پس از 15 دقیقه منقضی می‌شود.</p><p><strong>این کد را با کسی به اشتراک نگذارید.</strong></p><p>اگر درخواست بازنشانی نداده‌اید، این ایمیل را نادیده بگیرید.</p>`
  );
}

function encryptedSettingValue(nextValue: unknown, existingValue: unknown): string {
  const nextText = typeof nextValue === "string" ? nextValue.trim() : "";
  const existingText = typeof existingValue === "string" ? existingValue : "";
  if (!nextText) return existingText;
  if (isEncryptedValue(nextText)) return nextText;
  if (nextText === "***HIDDEN***") return existingText;
  return encrypt(nextText);
}

let readingTablesReady: Promise<void> | null = null;
async function ensureReadingFeatureTables(): Promise<void> {
  if (!readingTablesReady) {
    readingTablesReady = (async () => {
      await runOptionalSchemaQueries([`
        CREATE TABLE IF NOT EXISTS reading_progress (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
          novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
          novel_title TEXT,
          novel_cover TEXT,
          novel_genre TEXT,
          novel_author TEXT,
          chapter_id TEXT,
          chapter_title TEXT,
          chapter_number INTEGER DEFAULT 1,
          scroll_percentage NUMERIC DEFAULT 0,
          read_seconds INTEGER DEFAULT 0,
          completed BOOLEAN DEFAULT false,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS novel_cover TEXT`,
      `ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS novel_genre TEXT`,
      `ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS novel_author TEXT`,
      `ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS chapter_title TEXT`,
      `ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS read_seconds INTEGER DEFAULT 0`,
      `ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false`,
      `
        CREATE TABLE IF NOT EXISTS reading_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
          chapter_id TEXT,
          read_seconds INTEGER DEFAULT 0,
          scroll_percentage NUMERIC DEFAULT 0,
          source TEXT,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS novel_id TEXT`,
      `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS chapter_id TEXT`,
      `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS read_seconds INTEGER DEFAULT 0`,
      `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS scroll_percentage NUMERIC DEFAULT 0`,
      `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS source TEXT`,
      `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON reading_progress(user_id, updated_at DESC)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_progress_user_novel_unique ON reading_progress(user_id, novel_id) WHERE user_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_chapter ON reading_sessions(user_id, novel_id, chapter_id, created_at DESC)`]);
    })().catch((error) => {
      readingTablesReady = null;
      throw error;
    });
  }
  return readingTablesReady;
}

let bookmarkTablesReady: Promise<void> | null = null;
async function ensureBookmarkFeatureTables(): Promise<void> {
  if (!bookmarkTablesReady) {
    bookmarkTablesReady = (async () => {
      await runOptionalSchemaQueries([`
        CREATE TABLE IF NOT EXISTS bookmarks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          username TEXT,
          novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
          shelf_status TEXT DEFAULT 'plan_to_read',
          category_id TEXT,
          notes TEXT,
          visibility TEXT DEFAULT 'private',
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          UNIQUE(user_id, novel_id)
        )
      `,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS username TEXT`,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS novel_id TEXT`,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS shelf_status TEXT DEFAULT 'plan_to_read'`,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS category_id TEXT`,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private'`,
      `UPDATE bookmarks SET visibility='private' WHERE visibility IS NULL OR visibility NOT IN ('private', 'public')`,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL`,
      `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL`,
      `UPDATE bookmarks AS bookmark SET user_id = users.id FROM users WHERE bookmark.user_id IS NULL AND lower(bookmark.username) = lower(users.username)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_novel_unique ON bookmarks(user_id, novel_id) WHERE user_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_bookmarks_user_updated ON bookmarks(user_id, updated_at DESC)`]);
    })().catch((error) => {
      bookmarkTablesReady = null;
      throw error;
    });
  }
  return bookmarkTablesReady;
}

let authorLinksTableReady: Promise<void> | null = null;
async function ensureAuthorLinksTable(): Promise<void> {
  if (!authorLinksTableReady) {
    authorLinksTableReady = runOptionalSchemaQueries([`
      CREATE TABLE IF NOT EXISTS author_profile_links (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
      )
    `,
    `CREATE INDEX IF NOT EXISTS idx_author_profile_links_user_position ON author_profile_links(user_id, position, created_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_author_profile_links_user_url ON author_profile_links(user_id, url)`])
      .catch((error) => {
        authorLinksTableReady = null;
        throw error;
      });
  }
  return authorLinksTableReady;
}

function normalizeAuthorLinkUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Platforms an author may attach to their profile.
 *
 * `donate` is the financial-support entry (حمایت مالی): any HTTPS destination
 * the author uses to collect support — a payment page, a card-link service, or
 * a personal site. It is stored and rendered exactly like the social links, so
 * it inherits the same URL normalization, the 5-connection cap and the
 * one-row-per-platform rule.
 */
const supportedAuthorLinkPlatforms = new Set(["patreon", "youtube", "tiktok", "x", "instagram", "donate"]);

function isBookmarkStorageUnavailable(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "").toLowerCase();
  return isSchemaPermissionError(error) || ["42P01", "42703", "42P10"].includes(code) || message.includes("bookmarks");
}

function userBookmarkSettingsKey(user: any) {
  return `bookmarked_ids_user_${user.id}`;
}

function userBookmarkCategoriesKey(user: any) {
  return `bookmark_categories_user_${user.id}`;
}

async function readBookmarkIdsFromSettings(user: any): Promise<string[]> {
  const { data } = await supabase.from("settings").select("setting_value").eq("setting_key", userBookmarkSettingsKey(user)).single();
  if (!data?.setting_value) return [];
  try {
    const parsed = typeof data.setting_value === "string" ? JSON.parse(data.setting_value) : data.setting_value;
    return Array.isArray(parsed) ? parsed.map((id) => sanitizePlainText(id, 160)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function writeBookmarkIdsToSettings(user: any, ids: string[]) {
  const cleanIds = Array.from(new Set(ids.map((id) => sanitizePlainText(id, 160)).filter(Boolean)));
  await supabase.from("settings").upsert({
    setting_key: userBookmarkSettingsKey(user),
    setting_value: JSON.stringify(cleanIds),
    updated_at: new Date().toISOString()
  });
  return cleanIds;
}

async function getUserBookmarkIds(user: any): Promise<string[]> {
  try {
    await ensureBookmarkFeatureTables();
    const { data, error } = await supabase.from("bookmarks").select("novel_id").eq("user_id", user.id);
    if (!error && Array.isArray(data)) {
      const ids = data.map((bookmark: any) => sanitizePlainText(bookmark.novel_id, 160)).filter(Boolean);
      await writeBookmarkIdsToSettings(user, ids).catch(() => {});
      return ids;
    }
    if (error && !isBookmarkStorageUnavailable(error)) console.warn("Bookmark table read failed:", error.message || error);
  } catch (error) {
    if (!isBookmarkStorageUnavailable(error)) console.warn("Bookmark table ensure/read failed:", error);
  }
  return readBookmarkIdsFromSettings(user);
}

let userAdminColumnsReady: Promise<void> | null = null;
async function ensureUserAdminColumns(): Promise<void> {
  if (!userAdminColumnsReady) {
    userAdminColumnsReady = (async () => {
      await runOptionalSchemaQueries([
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS publishing_blocked BOOLEAN DEFAULT false`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_lifetime BOOLEAN DEFAULT false`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_author BOOLEAN DEFAULT false`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_role BOOLEAN DEFAULT false`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`
      ]);
    })().catch((error) => {
      // Managed PostgreSQL refuses ALTER TABLE for a non-owner role. Every
      // read below is column filtered, so report once instead of retrying the
      // same refused statement on each admin request.
      reportSchemaGapOnce("legacy admin user columns", error);
    });
  }
  return userAdminColumnsReady;
}

let emailTablesReady: Promise<void> | null = null;

async function ensureEmailFeatureTables(): Promise<void> {
  if (!emailTablesReady) {
    emailTablesReady = (async () => {
      await runOptionalSchemaQueries([`
        CREATE TABLE IF NOT EXISTS settings (
          setting_key TEXT PRIMARY KEY,
          setting_value TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS email_verifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS email_verification_failures (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          attempted_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `CREATE INDEX IF NOT EXISTS idx_email_verifications_user_active ON email_verifications (user_id, expires_at, consumed_at)`,
      `CREATE INDEX IF NOT EXISTS idx_email_verification_failures_user_time ON email_verification_failures (user_id, attempted_at)`]);
    })().catch((error) => {
      emailTablesReady = null;
      throw error;
    });
  }
  return emailTablesReady;
}

let passwordResetTablesReady: Promise<void> | null = null;

async function ensurePasswordResetTables(): Promise<void> {
  if (!passwordResetTablesReady) {
    passwordResetTablesReady = (async () => {
      await runOptionalSchemaQueries([`
        CREATE TABLE IF NOT EXISTS password_reset_codes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email_hash TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          request_ip_hash TEXT NOT NULL,
          request_user_agent_hash TEXT NOT NULL,
          attempts INTEGER DEFAULT 0,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          last_attempt_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS password_reset_attempts (
          id TEXT PRIMARY KEY,
          email_hash TEXT NOT NULL,
          ip_hash TEXT NOT NULL,
          purpose TEXT NOT NULL,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          succeeded BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS request_user_agent_hash TEXT`,
      `ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`,
      `ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`,
      `ALTER TABLE password_reset_attempts ADD COLUMN IF NOT EXISTS succeeded BOOLEAN DEFAULT false`,
      `CREATE INDEX IF NOT EXISTS idx_password_reset_codes_email_active ON password_reset_codes(email_hash, expires_at, consumed_at)`,
      `CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_active ON password_reset_codes(user_id, expires_at, consumed_at)`,
      `CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_email_time ON password_reset_attempts(email_hash, purpose, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_ip_time ON password_reset_attempts(ip_hash, purpose, created_at DESC)`]);
    })().catch((error) => {
      passwordResetTablesReady = null;
      throw error;
    });
  }
  return passwordResetTablesReady;
}

async function countPasswordResetAttempts(column: "email_hash" | "ip_hash", value: string, purpose: string, sinceIso: string): Promise<number> {
  const { count } = await supabase
    .from("password_reset_attempts")
    .select("*", { count: "exact", head: true })
    .eq(column, value)
    .eq("purpose", purpose)
    .gt("created_at", sinceIso);
  return count || 0;
}

async function recordPasswordResetAttempt(emailHash: string, ipHash: string, purpose: string, succeeded: boolean, userId?: string | null): Promise<void> {
  await supabase.from("password_reset_attempts").insert({
    id: `pra-${uuidv4()}`,
    email_hash: emailHash,
    ip_hash: ipHash,
    purpose: purpose.slice(0, 80),
    user_id: userId || null,
    succeeded
  });
}

async function findUserByNormalizedEmail(email: string): Promise<any | null> {
  const result = await db.query(
    `SELECT id, username, email, password, blocked FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
}

async function isPasswordResetRequestLimited(emailHash: string, ipHash: string): Promise<boolean> {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [emailHour, emailDay, ipWindow, ipDay] = await Promise.all([
    countPasswordResetAttempts("email_hash", emailHash, "request", oneHourAgo),
    countPasswordResetAttempts("email_hash", emailHash, "request", oneDayAgo),
    countPasswordResetAttempts("ip_hash", ipHash, "request", fifteenMinutesAgo),
    countPasswordResetAttempts("ip_hash", ipHash, "request", oneDayAgo)
  ]);
  return emailHour >= 3 || emailDay >= 6 || ipWindow >= 12 || ipDay >= 60;
}

async function isPasswordResetConfirmLimited(emailHash: string, ipHash: string): Promise<boolean> {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [emailFailures, ipFailures] = await Promise.all([
    countPasswordResetAttempts("email_hash", emailHash, "confirm_failed", fifteenMinutesAgo),
    countPasswordResetAttempts("ip_hash", ipHash, "confirm_failed", fifteenMinutesAgo)
  ]);
  return emailFailures >= 8 || ipFailures >= 25;
}

async function ensureSettingsTable(): Promise<void> {
  await runOptionalSchemaQueries([`
    CREATE TABLE IF NOT EXISTS settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
    )
  `]);
}

const TWOFA_PENDING_TTL_MS = 10 * 60 * 1000;
const TWOFA_PENDING_MAX_ATTEMPTS = 5;

function twofaPendingSettingsKey(userId: string) {
  return `twofa_pending_${userId}`;
}

function twofaSettingsKey(userId: string) {
  return `twofa_${userId}`;
}

function parseTwofaPendingSecret(value: unknown): any | null {
  if (!value) return null;
  const decrypted = typeof value === "string" ? decrypt(value) : null;
  const raw = decrypted || String(value || "");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.secret || !parsed?.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveTwofaPendingSecret(userId: string, secret: string) {
  await ensureSettingsTable();
  const now = new Date();
  const pending = {
    id: `twofa-setup-${uuidv4()}`,
    secret,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TWOFA_PENDING_TTL_MS).toISOString()
  };
  await supabase.from("settings").upsert({
    setting_key: twofaPendingSettingsKey(userId),
    setting_value: encrypt(JSON.stringify(pending)),
    updated_at: now.toISOString()
  });
  return pending;
}

async function loadTwofaPendingSecret(userId: string) {
  await ensureSettingsTable();
  const { data: row } = await supabase
    .from("settings")
    .select("setting_value")
    .eq("setting_key", twofaPendingSettingsKey(userId))
    .single();
  const pending = parseTwofaPendingSecret(row?.setting_value);
  if (!pending) return null;
  if (new Date(pending.expiresAt).getTime() < Date.now()) {
    await supabase.from("settings").delete().eq("setting_key", twofaPendingSettingsKey(userId));
    return null;
  }
  if (Number(pending.attempts || 0) >= TWOFA_PENDING_MAX_ATTEMPTS) {
    await supabase.from("settings").delete().eq("setting_key", twofaPendingSettingsKey(userId));
    return null;
  }
  return pending;
}

async function recordTwofaPendingFailure(userId: string, pending: any) {
  const attempts = Number(pending?.attempts || 0) + 1;
  if (attempts >= TWOFA_PENDING_MAX_ATTEMPTS) {
    await supabase.from("settings").delete().eq("setting_key", twofaPendingSettingsKey(userId));
    return;
  }
  await supabase.from("settings").upsert({
    setting_key: twofaPendingSettingsKey(userId),
    setting_value: encrypt(JSON.stringify({ ...pending, attempts, lastAttemptAt: new Date().toISOString() })),
    updated_at: new Date().toISOString()
  });
}

async function createSecureSession(req: express.Request, res: express.Response, userId: string, rememberMe = true) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const csrfCookie = crypto.randomBytes(32).toString('hex');
  
  // ✅ SECURITY: Default 24 hours, extended to 7 days only with explicit rememberMe
  const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours base
  const rememberMeDuration = rememberMe ? 7 * 24 * 60 * 60 * 1000 : SESSION_DURATION;
  const expiresAt = new Date(Date.now() + rememberMeDuration).toISOString();

  await supabase.from('sessions').insert({
    id: hashSessionToken(sessionId),
    user_id: userId,
    csrf_token: csrfToken,
    csrf_cookie: csrfCookie,
    expires_at: expiresAt,
    // ✅ Track last activity for idle-timeout enforcement.
    last_activity: new Date().toISOString(),
  });
  
  // Capture Device, Browser, OS, IP info
  const parser = new UAParser.UAParser(req.headers['user-agent'] || '');
  const result = parser.getResult();
  const rawIp = req.ip || req.connection?.remoteAddress || 'IP نامشخص';
  
  // ✅ SECURITY: Hash the IP with a pepper so the stored metadata cannot
  // be reverse-engineered to a specific user even if ENCRYPTION_KEY leaks.
  // The pepper is a separate env var so a single key compromise does not
  // deanonymize IP history.
  const ipHash = crypto
    .createHmac("sha256", process.env.IP_HASH_PEPPER || process.env.ENCRYPTION_KEY || "fallback-pepper")
    .update(rawIp)
    .digest("hex");

  const meta = {
    ip_hash: ipHash,
    ip_prefix: rawIp.split(".").slice(0, 3).join("."),
    browser: result.browser.name ? `${result.browser.name} ${result.browser.major || ''}` : 'مرورگر نامشخص',
    os: result.os.name ? `${result.os.name} ${result.os.version || ''}` : 'سیستم‌عامل نامشخص',
    device: result.device.type ? `${result.device.vendor || ''} ${result.device.model || ''} (${result.device.type})`.trim() : 'دسکتاپ/نامشخص',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const encryptedMeta = encrypt(JSON.stringify(meta));
  // ✅ Use the hashed session ID as the key, not the raw session ID.
  await supabase.from('settings').upsert({
    setting_key: `session_meta_${hashSessionToken(sessionId)}`,
    setting_value: encryptedMeta,
  });

  await createUserNotification(
    userId,
    "login_alert",
    "ورود جدید به حساب",
    `ورودی از ${meta.browser} روی ${meta.os} به حساب شما ثبت شد. اگر این کار شما نبوده است، این نشست را حذف کنید.`,
    `/profile?tab=security&session=${encodeURIComponent(sessionId)}`,
    "notify_logins"
  ).catch(() => {});

  const cookieOpts: any = {
    httpOnly: true,
    secure: secureCookiesEnabled,
    sameSite: "strict",
    path: "/",
  };
  
  cookieOpts.maxAge = rememberMeDuration;
  
  const encryptedSessionId = encrypt(sessionId);
  res.clearCookie("sessionId", { httpOnly: true, secure: secureCookiesEnabled, sameSite: "strict", path: "/api/auth" });
  res.clearCookie("session_token", { httpOnly: true, secure: secureCookiesEnabled, sameSite: "strict", path: "/api/auth" });
  res.cookie("sessionId", encryptedSessionId, { ...cookieOpts, signed: false }); // Signed could easily use cookie-parser secret but encrypted handles it
  
  // ✅ SECURITY: Use `__Host-` prefix to prevent subdomain cookie tossing.
  // __Host- prefixed cookies MUST have Secure=true, Path=/, no Domain.
  // This makes them unforgeable by any subdomain (which would otherwise
  // allow a compromised subdomain to overwrite the CSRF cookie).
  //
  // IMPORTANT: This change requires frontend updates — the React app must
  // read the cookie under the new name `__Host-XSRF-TOKEN` and send its
  // value in the `X-CSRF-Token` request header.
  const csrfCookieName = secureCookiesEnabled ? "__Host-XSRF-TOKEN" : "XSRF-TOKEN";
  res.cookie(csrfCookieName, csrfToken, {
    httpOnly: false,
    secure: secureCookiesEnabled,
    sameSite: "strict",
    path: "/",
    // ✅ Do not set Domain — __Host- requires no Domain attribute.
    maxAge: rememberMeDuration,
  });
  
  res.setHeader('X-CSRF-Token', csrfToken);

  return { sessionId, csrfToken, csrfCookie };
}

function sessionTokenFromRequest(req: express.Request): string | null {
  const cookieValue = req.cookies?.sessionId || req.cookies?.session_token;
  if (!cookieValue) return null;
  return decrypt(cookieValue) || null;
}

function clearAuthenticationCookies(res: express.Response) {
  const secureOptions = { httpOnly: true, secure: secureCookiesEnabled, sameSite: "strict" as const };
  // Clear the canonical cookie and cookies created by older builds whose
  // browser-default path was /api/auth.
  for (const pathValue of ["/", "/api/auth"]) {
    res.clearCookie("sessionId", { ...secureOptions, path: pathValue });
    res.clearCookie("session_token", { ...secureOptions, path: pathValue });
    res.clearCookie("XSRF-TOKEN", { secure: secureCookiesEnabled, sameSite: "strict", path: pathValue });
  }
  res.clearCookie("__Host-XSRF-TOKEN", { secure: true, sameSite: "strict", path: "/" });
}

async function getSessionForRequest(req: express.Request): Promise<any | null> {
  let sessionId = req.cookies?.sessionId || req.cookies?.session_token;
  if (sessionId) {
    const decryptedSessionId = decrypt(sessionId);
    if (decryptedSessionId) sessionId = decryptedSessionId;
  }

  if (!sessionId) return null;

  const query = supabase.from("sessions").select("*").eq("id", hashSessionToken(sessionId)).limit(1);

  const { data, error } = await query;
  const session = Array.isArray(data) ? data[0] : data;
  if (error || !session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  return session;
}

function buildClientUser(user: any, stats: any = {}) {
  const normalizedRole = String(user?.role || "writer").toLowerCase().trim();
  return {
    id: user.id,
    username: user.username,
    username_changed_at: user.username_changed_at || null,
    username_change_available_at: usernameChangeAvailableAt(user.username_changed_at),
    role: normalizedRole,
    custom_permissions: Array.isArray(user.custom_permissions) ? user.custom_permissions : [],
    custom_role_id: user.custom_role_id || null,
    is_staff: !!user.is_staff,
    is_premium: !!user.is_premium,
    premium_plan: user.premium_plan || null,
    level: user.level,
    xp: user.xp,
    coins: user.coins,
    streak: currentActivityStreak(user),
    avatar: user.avatar,
    twofa_enabled: !!user.twofa_enabled,
    email: user.email || null,
    phone: user.phone || null,
    nickname: user.nickname || null,
    first_name: user.first_name || null,
    last_name: user.last_name || null,
    email_verified: !!user.email_verified,
    google_connected: !!user.google_connected,
    password_set: user.password_set !== false,
    verified_author: user.verified_author || false,
    verified_role: user.verified_role || false,
    profile_bio: user.profile_bio || "",
    hours_read: stats.hours_read || 0,
    chapters_logged: stats.chapters_logged || 0,
    words_authored: stats.words_authored || 0,
    user_ranking: stats.user_ranking || "Unranked",
    ranking_basis: stats.ranking_basis || "reader",
    ranking_score: Number(stats.ranking_score || 0)
  };
}

async function getComputedUserRanking(userId: string) {
  try {
    const authorResult = await db.query(
      `SELECT COUNT(*)::int AS novel_count,
              COALESCE(MAX(CASE WHEN COALESCE(reviews_count, 0) > 0 THEN rating END), 0)::float8 AS best_rating
         FROM novels
        WHERE author_id=$1`,
      [userId]
    );
    const author = authorResult.rows[0] || {};
    if (Number(author.novel_count || 0) > 0) {
      const bestRating = Math.max(0, Number(author.best_rating || 0));
      if (bestRating <= 0) {
        return { user_ranking: "بدون رتبه", ranking_basis: "author", ranking_score: 0 };
      }
      const higherRatedAuthors = await db.query(
        `SELECT COUNT(*)::int AS higher_count
           FROM (
             SELECT author_id, MAX(rating)::float8 AS best_rating
               FROM novels
              WHERE COALESCE(reviews_count, 0) > 0
              GROUP BY author_id
           ) ranked_authors
          WHERE best_rating > $1`,
        [bestRating]
      );
      const rank = Number(higherRatedAuthors.rows[0]?.higher_count || 0) + 1;
      return { user_ranking: `#${rank.toLocaleString()}`, ranking_basis: "author", ranking_score: bestRating };
    }

    const readerResult = await db.query(
      `SELECT COALESCE(SUM(read_seconds), 0)::bigint AS read_seconds
         FROM reading_sessions
        WHERE user_id=$1
          AND foreground_active=true`,
      [userId]
    );
    const readSeconds = Math.max(0, Number(readerResult.rows[0]?.read_seconds || 0));
    if (readSeconds <= 0) {
      return { user_ranking: "بدون رتبه", ranking_basis: "reader", ranking_score: 0 };
    }
    const readersAhead = await db.query(
      `SELECT COUNT(*)::int AS higher_count
         FROM (
           SELECT user_id, SUM(read_seconds)::bigint AS read_seconds
             FROM reading_sessions
            WHERE user_id IS NOT NULL
              AND foreground_active=true
            GROUP BY user_id
         ) ranked_readers
        WHERE read_seconds > $1`,
      [readSeconds]
    );
    const rank = Number(readersAhead.rows[0]?.higher_count || 0) + 1;
    return { user_ranking: `#${rank.toLocaleString()}`, ranking_basis: "reader", ranking_score: readSeconds };
  } catch (error) {
    console.warn("Could not calculate live user ranking:", error instanceof Error ? error.message : error);
    return { user_ranking: "Unranked", ranking_basis: "reader", ranking_score: 0 };
  }
}

let googleAuthTablesReady: Promise<void> | null = null;
async function ensureGoogleAuthTables() {
  if (!googleAuthTablesReady) {
    googleAuthTablesReady = runOptionalSchemaQueries([
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_connected BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT true`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users (google_sub) WHERE google_sub IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY,
        action TEXT NOT NULL CHECK (action IN ('login', 'link')),
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON oauth_states (expires_at)`
    ]).then(() => undefined).catch((error) => {
      googleAuthTablesReady = null;
      throw error;
    });
  }
  return googleAuthTablesReady;
}

function googleRedirectUri() {
  const configured = String(process.env.GOOGLE_REDIRECT_URI || "").trim();
  if (configured) return configured;
  return `${String(process.env.APP_URL || "http://localhost:5174").replace(/\/$/, "")}/api/auth/google/callback`;
}

function oauthResultRedirect(res: express.Response, params: Record<string, string>) {
  const base = String(process.env.APP_URL || "http://localhost:5174").replace(/\/$/, "");
  const query = new URLSearchParams(params).toString();
  return res.redirect(303, `${base}/?${query}`);
}

function uniqueGoogleUsernameBase(profile: any) {
  const emailPrefix = String(profile.email || "").split("@")[0];
  const raw = emailPrefix || profile.given_name || profile.name || "reader";
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32) || "reader";
}

router.get("/health", (req, res) => {
  res.json({ status: "ok", mode: "node-production-postgres", timestamp: new Date().toISOString() });
});

router.get("/auth/google", async (req, res): Promise<any> => {
  try {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
      return oauthResultRedirect(res, { google: "error", message: "ورود با گوگل پیکربندی نشده است." });
    }
    await ensureGoogleAuthTables();
    const action = req.query.action === "link" ? "link" : "login";
    let userId: string | null = null;
    if (action === "link") {
      const user = await getActiveUser(req);
      if (!user) return res.status(401).json({ error: "پیش از اتصال گوگل، با رمز عبور خود وارد شوید." });
      userId = user.id;
    }
    const state = crypto.randomBytes(32).toString("base64url");
    const stateHash = crypto.createHash("sha256").update(state).digest("hex");
    await db.query(`DELETE FROM oauth_states WHERE expires_at <= now()`);
    await db.query(
      `INSERT INTO oauth_states (state_hash, action, user_id, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')`,
      [stateHash, action, userId]
    );
    res.cookie("google_oauth_state", state, {
      httpOnly: true,
      secure: secureCookiesEnabled,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/api/auth/google/callback"
    });
    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", googleRedirectUri());
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", "openid email profile");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("prompt", "select_account");
    return res.redirect(302, authorize.toString());
  } catch (error: any) {
    console.error("[auth:google] Start failed", error?.message || error);
    return oauthResultRedirect(res, { google: "error", message: "شروع ورود با گوگل ممکن نشد." });
  }
});

router.get("/auth/google/callback", authIpLimiter, async (req, res): Promise<any> => {
  const clearState = () => res.clearCookie("google_oauth_state", { path: "/api/auth/google/callback", sameSite: "lax" });
  try {
    await ensureGoogleAuthTables();
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const cookieState = String(req.cookies?.google_oauth_state || "");
    const stateBuffer = Buffer.from(state);
    const cookieStateBuffer = Buffer.from(cookieState);
    if (!code || !state || !cookieState || state.length > 200 || stateBuffer.length !== cookieStateBuffer.length || !crypto.timingSafeEqual(stateBuffer, cookieStateBuffer)) {
      clearState();
      return oauthResultRedirect(res, { google: "error", message: "درخواست تأیید گوگل نامعتبر یا منقضی شده است." });
    }
    const stateHash = crypto.createHash("sha256").update(state).digest("hex");
    const stateResult = await db.query(
      `DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING action, user_id`,
      [stateHash]
    );
    clearState();
    const pending = stateResult.rows[0];
    if (!pending) return oauthResultRedirect(res, { google: "error", message: "این درخواست تأیید گوگل منقضی شده است. لطفاً دوباره تلاش کنید." });

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: String(process.env.GOOGLE_CLIENT_ID || ""),
        client_secret: String(process.env.GOOGLE_CLIENT_SECRET || ""),
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code"
      })
    });
    const tokens: any = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error("Google token exchange failed");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile: any = await profileResponse.json();
    const email = String(profile.email || "").trim().toLowerCase();
    const googleSub = String(profile.sub || "").trim();
    if (!profileResponse.ok || !googleSub || !email || profile.email_verified !== true) {
      throw new Error("Google did not provide a verified email");
    }

    const byGoogle = await db.query(`SELECT * FROM users WHERE google_sub = $1 LIMIT 1`, [googleSub]);
    if (pending.action === "link") {
      if (byGoogle.rows[0] && byGoogle.rows[0].id !== pending.user_id) {
        return oauthResultRedirect(res, { google: "link_error", message: "آن حساب گوگل از قبل به حساب دیگری متصل است. نشست فعلی شما همچنان وارد باقی می‌ماند." });
      }
      const owner = await db.query(`SELECT id, email FROM users WHERE id = $1 LIMIT 1`, [pending.user_id]);
      if (!owner.rows[0]) return oauthResultRedirect(res, { google: "link_error", message: "حسابی که قرار بود متصل شود دیگر وجود ندارد." });
      if (owner.rows[0].email && String(owner.rows[0].email).toLowerCase() !== email) {
        return oauthResultRedirect(res, { google: "link_error", message: "ایمیل گوگل باید با ایمیل حساب شما یکسان باشد. اتصال گوگل انجام نشد و نشست فعلی شما همچنان وارد باقی می‌ماند." });
      }
      await db.query(
        `UPDATE users SET google_sub = $1, google_connected = true, email = COALESCE(email, $2), email_verified = true WHERE id = $3`,
        [googleSub, email, pending.user_id]
      );
      // The original Strict session cookie is intentionally not sent to Google's
      // cross-site callback. Issue a fresh first-party session so the returning
      // profile immediately reflects the newly linked identity.
      await createSecureSession(req, res, pending.user_id, true);
      await logSecurityEvent(SecurityEventType.LOGIN_SUCCESS, pending.user_id, { method: "google_link" }, req);
      return oauthResultRedirect(res, { google: "linked" });
    }

    let user = byGoogle.rows[0];
    if (!user) {
      const sameEmail = await db.query(`SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`, [email]);
      if (sameEmail.rows[0]) {
        return oauthResultRedirect(res, { google: "link_required", message: "حسابی با این ایمیل از قبل وجود دارد. ابتدا با رمز عبور خود وارد شوید، سپس در پیشخوان > امنیت گوگل را متصل کنید." });
      }
      const systemSettings = await readSystemSettings();
      if (systemSettings.allowRegistration === false) {
        return oauthResultRedirect(res, { google: "error", message: "ثبت‌نام در حال حاضر بسته است." });
      }
      const base = uniqueGoogleUsernameBase(profile);
      let username = base;
      let usernameFound = false;
      for (let suffix = 0; suffix < 100; suffix++) {
        const candidate = suffix ? `${base.slice(0, 27)}${suffix}` : base;
        if (!(await isUsernameUnavailable(candidate))) {
          username = candidate;
          usernameFound = true;
          break;
        }
      }
      if (!usernameFound) {
        username = `reader${crypto.randomBytes(6).toString("hex")}`.slice(0, 30);
      }
      // ✅ SECURITY: Use cryptographically random UUID. The previous format
// (timestamp + 4-digit random) was guessable: an attacker who knew the
// approximate registration time could enumerate ~10000 IDs to find a victim.
const id = `u-${crypto.randomUUID()}`;
      const unusablePassword = await bcrypt.hash(crypto.randomBytes(48).toString("base64url"), 12);
      const avatar = String(profile.picture || "").slice(0, 500) || username.slice(0, 2).toUpperCase();
      const inserted = await db.query(
        `INSERT INTO users (id, username, email, nickname, password, password_set, google_sub, google_connected, email_verified, role, level, xp, coins, streak, avatar)
         VALUES ($1,$2,$3,$4,$5,false,$6,true,true,'writer',1,0,100,1,$7) RETURNING *`,
        [id, username, email, String(profile.name || username).slice(0, 80), unusablePassword, googleSub, avatar]
      );
      user = inserted.rows[0];
    }
    if (user.blocked === true) return oauthResultRedirect(res, { google: "error", message: "این حساب توسط مدیر مسدود شده است." });
    const sessionDetails = await createSecureSession(req, res, user.id, true);
    await logSecurityEvent(SecurityEventType.LOGIN_SUCCESS, user.id, { method: "google" }, req);
    return oauthResultRedirect(res, { google: "success", password: user.password_set === false ? "required" : "set" });
  } catch (error: any) {
    clearState();
    console.error("[auth:google] Callback failed", error?.message || error);
    return oauthResultRedirect(res, { google: "error", message: "ورود با گوگل ناموفق بود. لطفاً دوباره تلاش کنید." });
  }
});

router.post("/auth/google/disconnect", sensitiveLimiter, async (req, res): Promise<any> => {
  try {
    await ensureGoogleAuthTables();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    if (!user.google_connected || !user.google_sub) {
      return res.status(400).json({ error: "هیچ حساب گوگلی متصل نیست." });
    }
    if (user.password_set === false) {
      return res.status(409).json({ error: "پیش از قطع اتصال گوگل، یک رمز عبور تنظیم کنید تا دسترسی به حساب خود را از دست ندهید." });
    }
    await db.query(`UPDATE users SET google_sub = NULL, google_connected = false WHERE id = $1`, [user.id]);
    await logSecurityEvent(SecurityEventType.SUSPICIOUS_ACTIVITY, user.id, { type: "google_disconnected" }, req);
    return res.json({ success: true, google_connected: false });
  } catch (error: any) {
    console.error("[auth:google] Disconnect failed", { userId: (req as any)?.user?.id, error: error?.message || String(error) });
    return res.status(400).json({ error: "اتصال گوگل قطع نشد." });
  }
});

router.get("/auth/google/status", async (req, res): Promise<any> => {
  try {
    await ensureGoogleAuthTables();
    const user = await getActiveUser(req);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    return res.json({ success: true, connected: !!user.google_connected && !!user.google_sub, accountEmail: user.email || null, passwordSet: user.password_set !== false });
  } catch {
    return res.status(400).json({ error: "وضعیت اتصال گوگل موقتاً در دسترس نیست." });
  }
});

router.post("/auth/register", [authIpLimiter, authLimiter, validate(schemas.register)], async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const systemSettings = await readSystemSettings();
    if (systemSettings.allowRegistration === false) {
      return res.status(403).json({ error: "ثبت‌نام در حال حاضر توسط مدیریت بسته شده است." });
    }

    const { username, password, email, phone, nickname } = req.body;
    const trimmedUser = username.trim();
    const usernameValidation = validateUsername(trimmedUser);
    if (usernameValidation.ok === false) {
      return res.status(400).json({ error: usernameValidation.error, code: usernameValidation.code });
    }
    if (await isUsernameUnavailable(trimmedUser)) {
      await logSecurityEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        null,
        { type: 'duplicate_registration', username: trimmedUser },
        req
      );
      return res.status(409).json({
        error: "این نام کاربری قبلاً استفاده شده یا برای همیشه رزرو شده است.",
        code: "USERNAME_UNAVAILABLE",
      });
    }

    // ✅ Set up user fields BEFORE insert (race-condition-safe path below).
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = `u-${uuidv4()}`;
    const finalRole = "writer"; // Prevent privilege escalation, always force standard role
    const avatar = nickname ? nickname.substring(0, 2).toUpperCase() : trimmedUser.substring(0, 2).toUpperCase();
    // Verification only applies when an email provider is actually configured;
    // otherwise requiring it would brick registration with no way to verify.
    let emailProviderAvailable = false;
    try {
      const { getEmailProviderAvailability } = await import("../utils/email");
      emailProviderAvailable = getEmailProviderAvailability(systemSettings.emailVerification || {}).any;
    } catch { emailProviderAvailable = false; }
    const emailVerificationEnabled = !!systemSettings.emailVerification?.enabled && !!email && emailProviderAvailable;

    // ✅ SECURITY (FIX 9): Insert with race-condition handling. Concurrent
    // registration requests that pass the friendly-check above can still
    // collide at the DB unique constraint; we surface a clean 409 instead
    // of bubbling up an unhandled error.
    const { error: insertError } = await supabase.from('users').insert({
      id: userId, username: trimmedUser, password: hashedPassword, email: email || null, phone: phone || null, nickname: nickname || null, role: finalRole, level: 1, xp: 0, coins: 100, streak: 0, avatar, email_verified: !emailVerificationEnabled
    }).select().single();

    if (insertError) {
      const code = String(insertError.code || "");
      const constraint = String((insertError as any).constraint || "");
      if (code === "23505") {
        if (constraint.includes("email")) {
          return res.status(409).json({ error: "حسابی با این ایمیل از قبل وجود دارد.", code: "EMAIL_TAKEN" });
        }
        if (constraint.includes("phone")) {
          return res.status(409).json({ error: "حسابی با این شماره تلفن از قبل وجود دارد.", code: "PHONE_TAKEN" });
        }
        return res.status(409).json({ error: "این نام کاربری قبلاً استفاده شده است.", code: "USERNAME_UNAVAILABLE" });
      }
      throw insertError;
    }

    const { data: selectedNewUser } = await supabase.from('users').select('id, username, email, phone, nickname, role, level, xp, coins, streak, avatar, email_verified').eq('id', userId).single();
    const newUser = selectedNewUser || {
      id: userId,
      username: trimmedUser,
      email: email || null,
      phone: phone || null,
      nickname: nickname || null,
      role: finalRole,
      level: 1,
      xp: 0,
      coins: 100,
      streak: 0,
      avatar,
      email_verified: !emailVerificationEnabled
    };
    
    const sessionDetails = await createSecureSession(req, res, userId);
    let verificationEmailSent: boolean | null = null;

    if (emailVerificationEnabled) {
      await ensureEmailFeatureTables();
      const code = generateSixDigitCode();
      const codeHash = await bcrypt.hash(code, 12);
      await supabase.from('email_verifications').insert({
        id: `ev-${uuidv4()}`,
        user_id: userId,
        email,
        code_hash: codeHash,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      });
      const sent = await sendVerificationCodeEmail(systemSettings, email, code).catch((sendError) => {
        console.error("[auth:register] Verification email send error", {
          userId,
          email,
          error: sendError?.message || String(sendError)
        });
        return false;
      });
      verificationEmailSent = sent;
      if (!sent) {
        console.error("[auth:register] Verification email could not be sent for new user", { userId, email });
        // Roll back the half-created account; a failed step must never stay silent.
        try { await supabase.from('email_verifications').delete().eq('user_id', userId); } catch (rollbackError) {
          console.error("[auth:register] rollback email_verifications failed", { userId, error: rollbackError });
        }
        try { await supabase.from('sessions').delete().eq('user_id', userId); } catch (rollbackError) {
          console.error("[auth:register] rollback sessions failed", { userId, error: rollbackError });
        }
        try {
          const deletedUser = await supabase.from('users').delete().eq('id', userId).select('id');
          if (deletedUser.error || !deletedUser.data?.length) {
            console.error("[auth:register] CRITICAL: rollback users failed — orphan account remains", { userId, error: deletedUser.error });
          }
        } catch (rollbackError) {
          console.error("[auth:register] CRITICAL: rollback users threw — orphan account remains", { userId, error: rollbackError });
        }
        res.clearCookie("sessionId");
        res.clearCookie("session_token");
        res.clearCookie("XSRF-TOKEN");
        return res.status(400).json({
          success: false,
          error: "ارسال ایمیل تأیید ممکن نشد. پیش از ثبت‌نام مجدد، اعتبارنامه‌های SMTP/Mailjet/Resend، تأیید فرستنده و لاگ‌های سرویس‌دهنده را بررسی کنید.",
          emailVerificationRequired: true,
          verificationEmailSent: false
        });
      }
    } else if (email) {
      import("../utils/email")
        .then(({ sendEmail }) => {
          return sendEmail(
            email,
            "به رپتوک خوش آمدید",
            `${trimmedUser} عزیز،\n\nحساب شما با موفقیت ایجاد شد.`,
            `<p><strong>${trimmedUser}</strong> عزیز،</p><p>حساب شما با موفقیت ایجاد شد.</p>`
          ).catch(() => false);
        }).catch(() => {});
    }

    // Always create a welcome message in our internal system
    try {
      await supabase.from('messages').insert({
        id: `msg-${uuidv4()}`,
        recipient_id: userId,
        sender_id: null,
        username: trimmedUser,
        sender: "مدیریت رپتوک",
        subject: "به رپتوک خوش آمدید! 🎉",
        snippet: "حساب شما با موفقیت ایجاد شد و آماده استفاده است.",
        is_read: 0
      });

      await supabase.from('notifications').insert({
        id: `notif-reg-${uuidv4()}`,
        user_id: userId,
        username: trimmedUser,
        title: "🛡️ نویسنده ثبت‌نام شد",
        text: `خوش آمدید! کاربر شما با نقش مجاز ${finalRole.toUpperCase()} ثبت شد.`,
        time: "همین حالا",
        is_read: 0
      });
    } catch {}

    // Award "Early Supporter"
    await checkAndAwardAchievement(userId, 'ach_comm_early');

    res.json({
      success: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        level: newUser.level,
        xp: newUser.xp,
        coins: newUser.coins,
        streak: newUser.streak,
        avatar: newUser.avatar,
        email: newUser.email,
        phone: newUser.phone,
        nickname: newUser.nickname,
        email_verified: !!newUser.email_verified,
        verified_author: false,
        verified_role: false,
        hours_read: 0,
        chapters_logged: 0,
        words_authored: 0,
        user_ranking: "بدون رتبه",
        ranking_basis: "reader",
        ranking_score: 0
      },
      csrfToken: sessionDetails.csrfToken,
      emailVerificationRequired: emailVerificationEnabled,
      verificationEmailSent
    });
  } catch (err: any) {
    console.error("Register error:", err?.message || err);
    if (String(err?.code || "") === "23505") {
      return res.status(409).json({
        error: "این نام کاربری، ایمیل یا شماره تلفن قبلاً استفاده شده است.",
        code: String(err?.constraint || "").includes("username")
          ? "USERNAME_UNAVAILABLE"
          : "ACCOUNT_IDENTITY_UNAVAILABLE",
      });
    }
    res.status(400).json({ error: "ثبت‌نام با وضعیت فعلی پایگاه داده قابل انجام نبود." });
  }
});

router.post("/auth/verify-email", [sensitiveLimiter], async (req, res): Promise<any> => {
  try {
    await ensureEmailFeatureTables();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const code = sanitizePlainText(req.body.code, 16).replace(/\D/g, "");
    if (code.length !== 6) return res.status(400).json({ error: "کد تأیید 6 رقمی را وارد کنید." });

    // Get non-consumed, non-expired verification records
    const { data: records } = await supabase
      .from('email_verifications')
      .select('*')
      .eq('user_id', user.id)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    // Track failed attempts
    let foundCode = false;
    
    for (const record of records || []) {
      // Use constant-time comparison to prevent timing attacks
      const isValid = await bcrypt.compare(code, record.code_hash);
      if (isValid) {
        // Mark as consumed
        await supabase.from('email_verifications')
          .update({ consumed_at: new Date().toISOString() })
          .eq('id', record.id);
        
        // Verify email
        await supabase.from('users')
          .update({ email_verified: true })
          .eq('id', user.id);
        
        foundCode = true;
        break;
      }
    }

    // If code not found after checking all records, increment failed attempts
    if (!foundCode) {
      // Log failed attempt (for rate limiting)
      await supabase.from('email_verification_failures').insert({
        id: `evf-${uuidv4()}`,
        user_id: user.id,
        attempted_at: new Date().toISOString()
      }).catch(() => {}); // Ignore errors

      return res.status(400).json({ error: "کد تأیید نامعتبر یا منقضی شده است." });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "تأیید ایمیل انجام نشد." });
  }
});

router.post("/auth/resend-verification", [sensitiveLimiter], async (req, res): Promise<any> => {
  try {
    await ensureEmailFeatureTables();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    if (!user.email) return res.status(400).json({ error: "این حساب آدرس ایمیلی ندارد." });

    // Check for too many resend attempts in short time (max 3 per hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentAttempts } = await supabase
      .from('email_verifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gt('created_at', oneHourAgo);

    if ((recentAttempts || 0) >= 3) {
      return res.status(429).json({ error: "تعداد تلاش‌های تأیید بیش از حد مجاز است. لطفاً یک ساعت دیگر دوباره تلاش کنید." });
    }

    const systemSettings = await readSystemSettings();
    if (!systemSettings.emailVerification?.enabled) return res.status(400).json({ error: "تأیید ایمیل غیرفعال است." });

    const code = generateSixDigitCode();
    const codeHash = await bcrypt.hash(code, 12);
    const verificationId = `ev-${uuidv4()}`;
    await supabase.from('email_verifications').insert({
      id: verificationId,
      user_id: user.id,
      email: user.email,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });

    const sent = await sendVerificationCodeEmail(systemSettings, user.email, code).catch((sendError) => {
      console.error("[auth:resend-verification] Verification email send error", {
        userId: user.id,
        email: user.email,
        error: sendError?.message || String(sendError)
      });
      return false;
    });
    if (!sent) {
      try { await supabase.from('email_verifications').delete().eq('id', verificationId); } catch {}
      console.error("[auth:resend-verification] Verification email could not be sent", { userId: user.id, email: user.email });
      return res.status(400).json({ error: "ارسال ایمیل تأیید ممکن نشد. لاگ‌های SMTP/Mailjet/Resend را روی سرور بررسی کنید." });
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[auth:resend-verification] Failed to resend verification code", { error: err?.message || String(err) });
    res.status(400).json({ error: "ارسال مجدد کد تأیید انجام نشد." });
  }
});

router.post("/auth/password-reset/request", [passwordResetRequestLimiter, validate(schemas.passwordResetRequest)], async (req, res): Promise<any> => {
  const startedAt = Date.now();
  try {
    await ensurePasswordResetTables();
    const email = normalizeAuthEmail(req.body.email);
    const emailHash = hashResetIdentifier(email);
    const ipHash = getRequestIpHash(req);
    const userAgentHash = getRequestUserAgentHash(req);

    if (await isPasswordResetRequestLimited(emailHash, ipHash)) {
      await recordPasswordResetAttempt(emailHash, ipHash, "request_limited", false).catch(() => {});
      await enforceMinimumResponseTime(startedAt);
      return res.status(429).json({ error: "درخواست‌های بازنشانی رمز عبور بیش از حد مجاز است. لطفاً بعداً دوباره تلاش کنید." });
    }

    await recordPasswordResetAttempt(emailHash, ipHash, "request", false).catch(() => {});

    const user = await findUserByNormalizedEmail(email);
    if (user && !(user.blocked === true || user.blocked === 1)) {
      const now = new Date().toISOString();
      await supabase
        .from("password_reset_codes")
        .update({ consumed_at: now })
        .eq("user_id", user.id)
        .is("consumed_at", null);

      const code = generateSixDigitCode();
      const codeHash = await bcrypt.hash(code, 12);
      const resetId = `prc-${uuidv4()}`;
      const { error: insertError } = await supabase.from("password_reset_codes").insert({
        id: resetId,
        user_id: user.id,
        email_hash: emailHash,
        code_hash: codeHash,
        request_ip_hash: ipHash,
        request_user_agent_hash: userAgentHash,
        attempts: 0,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      });

      if (!insertError) {
        const systemSettings = await readSystemSettings();
        const sent = await sendPasswordResetCodeEmail(systemSettings, user.email, code, user.username).catch((sendError) => {
          console.error("[auth:password-reset] Reset email send error", {
            userId: user.id,
            error: sendError?.message || String(sendError)
          });
          return false;
        });

        if (sent) {
          await recordPasswordResetAttempt(emailHash, ipHash, "sent", true, user.id).catch(() => {});
        } else {
          await supabase.from("password_reset_codes").update({ consumed_at: new Date().toISOString() }).eq("id", resetId).catch(() => {});
          await recordPasswordResetAttempt(emailHash, ipHash, "send_failed", false, user.id).catch(() => {});
        }
      } else {
        console.error("[auth:password-reset] Failed to store reset code", {
          userId: user.id,
          error: insertError?.message || String(insertError)
        });
      }
    }

    await enforceMinimumResponseTime(startedAt);
    res.json({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });
  } catch (err: any) {
    console.error("[auth:password-reset] Request failed", { error: err?.message || String(err) });
    await enforceMinimumResponseTime(startedAt).catch(() => {});
    res.status(400).json({ error: "بازنشانی رمز عبور موقتاً در دسترس نیست. لطفاً بعداً دوباره تلاش کنید." });
  }
});

router.post("/auth/password-reset/confirm", [passwordResetConfirmLimiter, validate(schemas.passwordResetConfirm)], async (req, res): Promise<any> => {
  const startedAt = Date.now();
  try {
    await ensurePasswordResetTables();
    const email = normalizeAuthEmail(req.body.email);
    const code = sanitizePlainText(req.body.code, 16).replace(/\D/g, "");
    const newPassword = String(req.body.newPassword || "");
    const emailHash = hashResetIdentifier(email);
    const ipHash = getRequestIpHash(req);

    if (code.length !== 6 || !isStrongPassword(newPassword)) {
      await enforceMinimumResponseTime(startedAt);
      return res.status(400).json({ error: "جزئیات بازنشانی نامعتبر است. کد و شرایط رمز عبور را بررسی کنید." });
    }

    if (await isPasswordResetConfirmLimited(emailHash, ipHash)) {
      await recordPasswordResetAttempt(emailHash, ipHash, "confirm_limited", false).catch(() => {});
      await enforceMinimumResponseTime(startedAt);
      return res.status(429).json({ error: "تلاش‌ها برای کد بازنشانی بیش از حد مجاز است. لطفاً کد جدیدی درخواست کنید و بعداً دوباره تلاش کنید." });
    }

    const { data: rawRecords } = await supabase
      .from("password_reset_codes")
      .select("*")
      .eq("email_hash", emailHash)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(5);

    const records = Array.isArray(rawRecords) ? rawRecords.filter((record: any) => Number(record.attempts || 0) < 5) : [];
    let matchedRecord: any | null = null;

    for (const record of records) {
      const ok = await bcrypt.compare(code, record.code_hash);
      if (ok) {
        matchedRecord = record;
        break;
      }
    }

    if (!matchedRecord) {
      const ids = records.map((record: any) => record.id).filter(Boolean);
      if (ids.length) {
        await db.query(
          `UPDATE password_reset_codes
             SET attempts = COALESCE(attempts, 0) + 1,
                 last_attempt_at = timezone('utc'::text, now()),
                 consumed_at = CASE WHEN COALESCE(attempts, 0) + 1 >= 5 THEN timezone('utc'::text, now()) ELSE consumed_at END
           WHERE id = ANY($1)`,
          [ids]
        ).catch(() => {});
      }
      await recordPasswordResetAttempt(emailHash, ipHash, "confirm_failed", false).catch(() => {});
      await enforceMinimumResponseTime(startedAt);
      return res.status(400).json({ error: "کد بازنشانی نامعتبر یا منقضی شده است." });
    }

    const user = await findUserByNormalizedEmail(email);
    if (!user || user.id !== matchedRecord.user_id || user.blocked === true || user.blocked === 1) {
      await supabase.from("password_reset_codes").update({ consumed_at: new Date().toISOString() }).eq("id", matchedRecord.id).catch(() => {});
      await recordPasswordResetAttempt(emailHash, ipHash, "confirm_failed", false, matchedRecord.user_id).catch(() => {});
      await enforceMinimumResponseTime(startedAt);
      return res.status(400).json({ error: "کد بازنشانی نامعتبر یا منقضی شده است." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE users
            SET password = $1,
                login_attempts = 0,
                locked_until = NULL,
                email_verified = true
          WHERE id = $2`,
        [hashedPassword, user.id]
      );
      await client.query(
        `UPDATE password_reset_codes
            SET consumed_at = timezone('utc'::text, now())
          WHERE user_id = $1 AND consumed_at IS NULL`,
        [user.id]
      );
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
    });

    await recordPasswordResetAttempt(emailHash, ipHash, "confirm_success", true, user.id).catch(() => {});
    await logSecurityEvent(
      SecurityEventType.PASSWORD_CHANGE,
      user.id,
      { method: "email_reset", timestamp: new Date().toISOString() },
      req
    );

    res.clearCookie("sessionId", { sameSite: "strict" });
    res.clearCookie("session_token", { sameSite: "strict" });
    res.clearCookie("XSRF-TOKEN", { sameSite: "strict" });
    await enforceMinimumResponseTime(startedAt);
    res.json({ success: true, message: "رمز عبور شما بازنشانی شد. لطفاً با رمز عبور جدید وارد شوید." });
  } catch (err: any) {
    console.error("[auth:password-reset] Confirm failed", { error: err?.message || String(err) });
    await enforceMinimumResponseTime(startedAt).catch(() => {});
    res.status(400).json({ error: "بازنشانی رمز عبور کامل نشد. لطفاً کد جدیدی درخواست کنید." });
  }
});

router.post("/auth/login", [authIpLimiter, authLimiter, validate(schemas.login)], async (req: express.Request, res: express.Response): Promise<any> => {
  const startedAt = Date.now();
  try {
    const { username, password, rememberMe } = req.body;
    const trimmedUser = username.trim();

    const normalizedLogin = trimmedUser.toLowerCase();
    const loginResult = await db.query(
      `SELECT * FROM users
       WHERE lower(username) = $1 OR lower(email) = $1 OR phone = $2
       ORDER BY CASE WHEN lower(username) = $1 THEN 0 WHEN lower(email) = $1 THEN 1 ELSE 2 END
       LIMIT 1`,
      [normalizedLogin, trimmedUser]
    );
    const targetUser: any = loginResult.rows[0] || null;
    if (!targetUser) {
      // Burn the same bcrypt cost as a real comparison so response timing
      // cannot reveal whether the username exists.
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      await logSecurityEvent(
        SecurityEventType.LOGIN_FAILURE,
        null,
        { username: trimmedUser, reason: 'User not found' },
        req
      );
      await enforceMinimumResponseTime(startedAt, 400).catch(() => {});
      return res.status(401).json({ error: "نام کاربری یا رمز عبور نادرست است." });
    }

    if (targetUser.blocked === true || targetUser.blocked === 1) {
      await logSecurityEvent(
        SecurityEventType.PERMISSION_DENIED,
        targetUser.id,
        { username: trimmedUser, reason: "Account login blocked by administrator" },
        req
      );
      return res.status(403).json({ error: "این حساب توسط مدیر مسدود شده است." });
    }

    if (targetUser.locked_until && new Date(targetUser.locked_until) > new Date()) {
      const remainingMinutes = Math.ceil(
        (new Date(targetUser.locked_until).getTime() - Date.now()) / (60 * 1000)
      );
      return res.status(429).json({ 
        error: `حساب به دلیل تلاش‌های ناموفق مکرر به مدت ${remainingMinutes} دقیقه قفل شده است.` 
      });
    }

    const match = await bcrypt.compare(password, targetUser.password);
    if (!match) {
      const newAttempts = (targetUser.login_attempts || 0) + 1;
      const update: any = { login_attempts: newAttempts };
      
      if (newAttempts >= 5) {
        // Cap the temporary lock at 60 minutes so a third party cannot weaponize
    // the lockout into a multi-day denial-of-service against a victim's login.
    const lockDuration = Math.min(15 * (newAttempts - 4), 60); // max 60 minutes
        update.locked_until = new Date(Date.now() + lockDuration * 60 * 1000).toISOString();
      }
      
      await supabase.from('users').update(update).eq('id', targetUser.id);
      
      await logSecurityEvent(
        SecurityEventType.LOGIN_FAILURE,
        targetUser.id,
        { attempts: newAttempts },
        req
      );
      return res.status(401).json({ error: "نام کاربری یا رمز عبور نادرست است." });
    }

    // ✅ SECURITY: Do NOT reset login_attempts yet. Reset only AFTER 2FA
    // succeeds. If 2FA fails repeatedly, the underlying account should still
    // be subject to the lockout.
    // (Login-attempt counter is incremented in the password-mismatch branch
    // above; here, password was correct so we leave the counter alone.)
    if (!targetUser.twofa_enabled) {
      await supabase
        .from('users')
        .update({ login_attempts: 0, locked_until: null })
        .eq('id', targetUser.id);
    }

    // ✅ NEW: Check if 2FA is enabled
    if (targetUser.twofa_enabled) {
      // Generate temporary OTP session token
      const otpSessionId = `otp-${uuidv4()}`;
      const otpSessionToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP session — only the SHA-256 hash of the token is persisted,
      // so a database leak cannot replay pending 2FA sessions.
      await supabase.from('otp_sessions').insert({
        id: otpSessionId,
        user_id: targetUser.id,
        session_token: hashSessionToken(otpSessionToken),
        expires_at: expiresAt.toISOString()
      });

      await logSecurityEvent(
        SecurityEventType.LOGIN_AWAITING_2FA,
        targetUser.id,
        { method: '2FA' },
        req
      );

      return res.status(200).json({
        success: false,
        requiresOTP: true,
        otpSessionToken: otpSessionToken,
        userId: targetUser.id,
        message: "احراز هویت دومرحله‌ای لازم است. لطفاً کد 6 رقمی اپلیکیشن احراز هویت خود را وارد کنید."
      });
    }

    // ✅ No 2FA or 2FA verified - create session
    const sessionDetails = await createSecureSession(req, res, targetUser.id, rememberMe !== false);

    // Fetch stats
    const { data: statsEntry } = await supabase.from('settings').select('setting_value').eq('setting_key', userStatsKey(targetUser.id)).single();
    let stats = { hours_read: 0, chapters_logged: 0, words_authored: 0, user_ranking: "#0" };
    if (statsEntry?.setting_value) {
      try {
        stats = typeof statsEntry.setting_value === 'string' ? JSON.parse(statsEntry.setting_value) : statsEntry.setting_value;
      } catch {}
    }

    const hydratedLoginUser = await getActiveUser(req);
    stats = { ...stats, ...await getComputedUserRanking(targetUser.id) };
    const clientUser = buildClientUser(hydratedLoginUser || targetUser, stats);

    await logSecurityEvent(
      SecurityEventType.LOGIN_SUCCESS,
      targetUser.id,
      { method: 'password' },
      req
    );

    res.json({ success: true, user: clientUser, csrfToken: sessionDetails.csrfToken });
  } catch (err) {
    res.status(400).json({ error: "احراز هویت نشست انجام نشد." });
  }
});

// ✅ SECURITY: Logout is now CSRF-protected via requireUserWithCsrf.
// Previously, an attacker could force-logout a victim via a hidden form POST.
router.post("/auth/logout", async (req, res) => {
  try {
    const sessionToken = sessionTokenFromRequest(req);
    if (sessionToken) {
      const sessionHash = hashSessionToken(sessionToken);
      const existing = await db.query("SELECT id FROM sessions WHERE id=$1", [sessionHash]);
      // If the security screen already revoked this session, logout remains
      // idempotent. Existing sessions still require their CSRF proof.
      if (existing.rows.length > 0) {
        const user = await getActiveUser(req, true);
        if (!user) return res.status(401).json({ error: "درخواست خروج معتبر نیست." });
        await db.withTransaction(async (client) => {
          const deleted = await client.query(
            "DELETE FROM sessions WHERE id=$1 AND user_id=$2 RETURNING id",
            [sessionHash, user.id]
          );
          if (deleted.rowCount !== 1) throw new Error("Current session was not deleted");
          await client.query("DELETE FROM settings WHERE setting_key=$1", [`session_meta_${sessionHash}`]);
        });
      }
    }
    clearAuthenticationCookies(res);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "خروج از حساب انجام نشد." });
  }
});

router.get("/auth/me", async (req, res) => {
  try {
    try {
      await ensureReadingFeatureTables();
      await ensureAnalyticsTables();
    } catch (migrationError) {
      console.warn("Reading feature table ensure failed; continuing auth/me with fallbacks.", migrationError);
    }
    const session = await getSessionForRequest(req);
    const user = await getActiveUser(req);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    // Achievement evaluation is a side effect of loading the session: it must
    // never fail the request, and a missing table is reported once by the
    // schema helper rather than on every /auth/me call.
    await evaluateAndAwardUserAchievements(user).catch((error) => {
      reportSchemaGapOnce("achievement evaluation", error);
    });
    if (session?.csrf_token) {
      const remainingMs = Math.max(0, new Date(session.expires_at).getTime() - Date.now());
      res.setHeader("X-CSRF-Token", session.csrf_token);
      res.cookie("XSRF-TOKEN", session.csrf_token, {
        httpOnly: false,
        secure: secureCookiesEnabled,
        sameSite: "strict",
        maxAge: remainingMs
      });
    }

    let readingProgress: any[] = [];
    const { data: userReadingProgress } = await supabase
      .from('reading_progress')
      .select('*')
      .eq("user_id", user.id)
      .order('updated_at', { ascending: false });
    readingProgress = Array.isArray(userReadingProgress) ? userReadingProgress : [];
    const bookmarkedIds = await getUserBookmarkIds(user);
    await ensureNotificationTable();
    const { data: notificationsById } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    const notifications = notificationsById || [];
    const { data: messages } = await supabase.from('messages').select('*').eq('recipient_id', user.id).order('created_at', { ascending: false });
    
    const { data: myCommentsData } = await supabase
      .from('reviews')
      .select('id, content, rating, created_at, novels!inner(title)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    // Format structure
    const myComments = (myCommentsData || []).map((c: any) => ({
      id: c.id,
      novelTitle: c.novels?.title,
      comment: c.content,
      rating: c.rating,
      createdAt: c.created_at
    }));

    // Fetch stats
    const { data: statsEntry } = await supabase.from('settings').select('setting_value').eq('setting_key', userStatsKey(user.id)).single();
    let stats = { hours_read: 0, chapters_logged: 0, words_authored: 0, user_ranking: "#0" };
    if (statsEntry?.setting_value) {
      try {
        stats = typeof statsEntry.setting_value === 'string' ? JSON.parse(statsEntry.setting_value) : statsEntry.setting_value;
      } catch {}
    }

    const { data: readingSessions } = await supabase
      .from("reading_sessions")
      .select("chapter_id, read_seconds, scroll_percentage, created_at, foreground_active")
      .eq("user_id", user.id)
      .eq("foreground_active", true);
    const completedChapterIds = new Set<string>();
    let totalReadSeconds = 0;
    (readingSessions || []).forEach((session: any) => {
      totalReadSeconds += Math.max(0, Number(session.read_seconds || 0));
      if (session.chapter_id && Number(session.scroll_percentage || 0) >= 90) {
        completedChapterIds.add(session.chapter_id);
      }
    });
    (readingProgress || []).forEach((progress: any) => {
      if (progress.chapter_id && (progress.completed || Number(progress.scroll_percentage || 0) >= 90)) {
        completedChapterIds.add(progress.chapter_id);
      }
    });
    const realHoursRead = Number((totalReadSeconds / 3600).toFixed(2));
    // reading_sessions is the source of truth. Keeping the larger legacy
    // setting preserved inflated wall-clock totals after the tracker was fixed.
    stats.hours_read = realHoursRead;
    stats.chapters_logged = Math.max(Number(stats.chapters_logged || 0), completedChapterIds.size);
    stats = { ...stats, ...await getComputedUserRanking(user.id) };
    await supabase.from("settings").upsert({
      setting_key: userStatsKey(user.id),
      setting_value: JSON.stringify(stats),
      updated_at: new Date().toISOString()
    }).catch(() => {});

    // Check premium expiry
    // getActiveUser projects effective Reader Premium from all independent sources.
    const isPremium = !!user.has_reader_premium;

    // Load claimed achievements
    let claimedAchievements: string[] = [];
    const { data: claims } = await supabase.from('user_achievements').select('achievement_id').eq('user_id', user.id);
    if (claims) {
      claimedAchievements = claims.map(c => c.achievement_id);
    }
    // Fallback
    const achKey = userAchievementSettingsKey(user.id);
    const { data: existingAchSettings } = await supabase.from('settings').select('setting_value').eq('setting_key', achKey).single();
    if (existingAchSettings && existingAchSettings.setting_value) {
      try {
        const fallbacks = typeof existingAchSettings.setting_value === 'string' ? JSON.parse(existingAchSettings.setting_value) : existingAchSettings.setting_value;
        fallbacks.forEach((f: string) => {
          if (!claimedAchievements.includes(f)) claimedAchievements.push(f);
        });
      } catch {}
    }

    res.json({
      success: true,
      csrfToken: session?.csrf_token,
      user: {
        id: user.id,
        username: user.username,
        username_changed_at: user.username_changed_at || null,
        username_change_available_at: usernameChangeAvailableAt(user.username_changed_at),
        role: String(user.role || "writer").toLowerCase().trim(),
        custom_permissions: Array.isArray(user.custom_permissions) ? user.custom_permissions : [],
        custom_role_id: user.custom_role_id || null,
        is_staff: !!user.is_staff,
        is_premium: isPremium,
        has_reader_premium: !!user.has_reader_premium,
        has_writer_premium: !!user.has_writer_premium,
        premium_plan: user.premium_plan || null,
        level: user.level,
        xp: user.xp,
        coins: user.coins,
        streak: currentActivityStreak(user),
        avatar: user.avatar,
        twofa_enabled: !!user.twofa_enabled,
        email: user.email || null,
        phone: user.phone || null,
        nickname: user.nickname || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        email_verified: !!user.email_verified,
        verified_author: user.verified_author || false,
        verified_role: user.verified_role || false,
        profile_bio: user.profile_bio || "",
        hours_read: stats.hours_read || 0,
        chapters_logged: stats.chapters_logged || 0,
        words_authored: stats.words_authored || 0,
        user_ranking: stats.user_ranking || "بدون رتبه",
        ranking_basis: (stats as any).ranking_basis || "reader",
        ranking_score: Number((stats as any).ranking_score || 0)
      },
      userData: {
        readingProgress: (readingProgress || []).map((p: any) => ({
          novelId: p.novel_id,
          novelTitle: p.novel_title,
          novelCover: p.novel_cover || "",
          novelGenre: p.novel_genre || "",
          novelAuthor: p.novel_author || "",
          chapterId: p.chapter_id,
          chapterTitle: p.chapter_title || "",
          chapterNumber: p.chapter_number,
          scrollPercent: Number(p.scroll_percentage || 0),
          scrollPercentage: Number(p.scroll_percentage || 0),
          readSeconds: Number(p.read_seconds || 0),
          completed: !!p.completed,
          updatedAt: p.updated_at,
          lastRead: p.updated_at
        })),
        bookmarkedIds,
        notifications: (notifications || []).map((n: any) => ({
          id: n.id, title: n.title, text: n.text, time: n.time, type: n.type, link: n.link, read: n.is_read === 1 || n.is_read === true
        })),
        emails: (messages || []).map((m: any) => ({
          id: m.id, sender: m.sender, subject: m.subject, snippet: m.snippet, time: m.time, link: m.link || "", read: m.is_read === 1 || m.is_read === true
        })),
        myComments,
        claimedAchievements
      }
    });
  } catch {
    res.status(401).json({ error: "نشست شما معتبر نیست." });
  }
});

router.patch("/auth/profile", [sensitiveLimiter, validate(schemas.profileIdentity)], async (req, res): Promise<any> => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
    const phone = req.body.phone ? String(req.body.phone).trim() : null;
    const firstName = sanitizePlainText(req.body.firstName, 80).trim() || null;
    const lastName = sanitizePlainText(req.body.lastName, 80).trim() || null;

    if (email && email !== user.email) {
      const { data: existingEmail } = await supabase.from("users").select("id").eq("email", email).limit(1);
      if (existingEmail?.some((entry: any) => entry.id !== user.id)) {
        return res.status(409).json({ error: "این آدرس ایمیل قبلاً استفاده شده است." });
      }
    }
    if (phone && phone !== user.phone) {
      const { data: existingPhone } = await supabase.from("users").select("id").eq("phone", phone).limit(1);
      if (existingPhone?.some((entry: any) => entry.id !== user.id)) {
        return res.status(409).json({ error: "این شماره تلفن قبلاً استفاده شده است." });
      }
    }

    // ✅ SECURITY (H-1): Defense-in-depth whitelist. Even though this endpoint
    // already uses explicit variables, this final check guarantees that no
    // future code change (e.g. adding "nickname" handling) can accidentally
    // pass through untrusted fields like `role`, `level`, `coins`, `is_premium`.
    const ALLOWED_PROFILE_UPDATE_FIELDS = new Set([
      "email", "phone", "first_name", "last_name", "email_verified",
    ]);
    const updates: any = { email, phone, first_name: firstName, last_name: lastName };
    if (email !== (user.email || null)) updates.email_verified = false;
    // ✅ Strip any field that's not in the whitelist (defense in depth).
    for (const key of Object.keys(updates)) {
      if (!ALLOWED_PROFILE_UPDATE_FIELDS.has(key)) {
        delete updates[key];
      }
    }
    // The account can be deleted between auth and this write; report 404
    // instead of a generic failure when the row no longer exists.
    const { data: updated, error } = await supabase.from("users").update(updates).eq("id", user.id).select("*").single();
    if (error) {
      if ((error as any)?.code === "PGRST116") return res.status(404).json({ error: "حساب کاربری یافت نشد." });
      throw error;
    }

    res.json({ success: true, user: buildClientUser(updated) });
  } catch (err: any) {
    console.error("Profile identity update error:", err?.message || err);
    res.status(400).json({ error: "به‌روزرسانی اطلاعات پروفایل انجام نشد." });
  }
});

router.patch("/auth/username", [sensitiveLimiter, validate(schemas.usernameChange)], async (req, res): Promise<any> => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    const result = await changeUsername(user.id, req.body.username);
    await logSecurityEvent(
      SecurityEventType.USERNAME_CHANGE,
      user.id,
      {
        previousUsername: result.previousUsername,
        username: result.user.username,
        activeSessionsPreserved: true,
      },
      req,
    );
    return res.json({
      success: true,
      user: buildClientUser(result.user),
      previousUsername: result.previousUsername,
      usernameChangeAvailableAt: result.availableAt,
      profileUrl: `/authors/${encodeURIComponent(result.user.username)}`,
    });
  } catch (error: any) {
    if (error instanceof UsernameChangeError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
        usernameChangeAvailableAt: error.availableAt || null,
      });
    }
    if (["42P01", "42703"].includes(String(error?.code || ""))) {
      return res.status(503).json({
        error: "تغییر نام کاربری تا پایان استقرار مهاجرت هویت موقتاً در دسترس نیست.",
        code: "USERNAME_MIGRATION_REQUIRED",
      });
    }
    console.error("Username change failed.", {
      userId: (await getActiveUser(req, false).catch(() => null))?.id,
      code: error?.code,
      constraint: error?.constraint,
      message: error?.message,
    });
    return res.status(400).json({ error: "تغییر نام کاربری ممکن نشد.", code: "USERNAME_CHANGE_FAILED" });
  }
});

router.get("/auth/sessions", async (req, res) => {
  try {
    const user = await getActiveUser(req);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const expired = await db.query("DELETE FROM sessions WHERE user_id=$1 AND expires_at <= NOW() RETURNING id", [user.id]);
    for (const row of expired.rows) {
      await supabase.from("settings").delete().eq("setting_key", `session_meta_${row.id}`).catch(() => {});
    }
    const { data: sessions } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .order('created_at', { ascending: false });
    
    // Fetch meta from settings
    const sessionIds = (sessions || []).map((s: any) => `session_meta_${s.id}`);
    let metas: any[] = [];
    if (sessionIds.length > 0) {
      const { data } = await supabase.from('settings').select('*').in('setting_key', sessionIds);
      if (data) metas = data;
    }
    
    const metaMap: Record<string, any> = {};
    (metas || []).forEach((m: any) => {
       try {
         const decrypted = decrypt(m.setting_value);
         metaMap[m.setting_key] = JSON.parse(decrypted);
       } catch {
         // fallback if it wasn't encrypted
         try {
           metaMap[m.setting_key] = JSON.parse(m.setting_value);
         } catch {}
       }
    });

    // Check which one is current
    const currentSessionToken = sessionTokenFromRequest(req);
    const currentSessionId = currentSessionToken ? hashSessionToken(currentSessionToken) : "";
    
    res.json({
      success: true,
      sessions: (sessions || []).map((s: any) => ({
        id: s.id,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        isCurrent: s.id === currentSessionId,
        meta: metaMap[`session_meta_${s.id}`] || { ip: 'نامشخص', browser: 'نامشخص', os: 'نامشخص', device: 'نامشخص' }
      }))
    });
  } catch (err) {
    res.status(400).json({ error: "دریافت نشست‌ها انجام نشد." });
  }
});

router.delete("/auth/sessions/:id", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const sessionId = req.params.id;
    // ensure the session belongs to user
    const { data: targetSession } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (!targetSession || targetSession.user_id !== user.id) {
      return res.status(403).json({ error: "دسترسی غیرمجاز." });
    }

    await db.withTransaction(async (client) => {
      const deleted = await client.query(
        "DELETE FROM sessions WHERE id=$1 AND user_id=$2 RETURNING id",
        [sessionId, user.id]
      );
      if (deleted.rowCount !== 1) throw new Error("Target session was not deleted");
      await client.query("DELETE FROM settings WHERE setting_key=$1", [`session_meta_${sessionId}`]);
    });
    
    const currentSessionToken = sessionTokenFromRequest(req);
    const currentSessionId = currentSessionToken ? hashSessionToken(currentSessionToken) : "";
    
    if (currentSessionId && targetSession.id === currentSessionId) {
      clearAuthenticationCookies(res);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "حذف نشست انجام نشد." });
  }
});

router.post("/auth/change-password", sensitiveLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { currentPassword, newPassword } = req.body;
    if (!newPassword || (user.password_set !== false && !currentPassword)) return res.status(400).json({ error: "فیلدها کامل ارسال نشده‌اند." });

    if (user.password_set !== false) {
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(401).json({ error: "رمز عبور فعلی نادرست است." });
    }

    if (newPassword.length < 12 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^a-zA-Z0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "رمز عبور جدید باید حداقل 12 کاراکتر باشد و شامل حرف بزرگ، حرف کوچک، عدد و کاراکتر ویژه باشد." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    await supabase.from('users').update({ password: hashedPassword, password_set: true }).eq('id', user.id);
    
    // ✅ SECURITY: After a password change, regenerate the current session
    // as well (not just delete others). This ensures the new CSRF token /
    // session ID are bound to the post-change credentials, preventing
    // session-fixation where an attacker-set session ID survives a password
    // change.
    const currentSessionIdEnc = req.cookies?.sessionId || "";
    // Decrypt if needed, or if it's not encrypted? It is encrypted, so decrypt it.
    let currentSessionId = currentSessionIdEnc;
    const dec = decrypt(currentSessionIdEnc);
    if (dec) currentSessionId = dec;
    
    // Delete ALL sessions for this user (including the current one).
    await supabase
      .from('sessions')
      .delete()
      .eq('user_id', user.id);

    // Clean up old session_meta from settings table (keyed by hashed ID).
    if (currentSessionId) {
      await supabase
        .from('settings')
        .delete()
        .eq('setting_key', `session_meta_${hashSessionToken(currentSessionId)}`)
        .catch(() => {});
    }

    // Issue a brand-new session with fresh CSRF token.
    const newSession = await createSecureSession(req, res, user.id, true);
    
    await logSecurityEvent(
      SecurityEventType.PASSWORD_CHANGE,
      user.id,
      { timestamp: new Date().toISOString() },
      req
    );

    res.json({
      success: true,
      message: "رمز عبور با موفقیت تغییر کرد",
      csrfToken: newSession.csrfToken,
    });
  } catch (err) {
    res.status(400).json({ error: "تغییر رمز عبور انجام نشد." });
  }
});

router.delete("/auth/account", sensitiveLimiter, async (req, res) => {
  const requestId = `account-delete-${crypto.randomBytes(5).toString("hex")}`;
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما یافت نشد یا منقضی شده است.", code: "AUTH_REQUIRED", requestId });
    if (String(req.body?.confirmation || "").trim() !== "DELETE") {
      return res.status(422).json({ error: "برای تأیید حذف حساب، دقیقاً عبارت DELETE را وارد کنید.", code: "CONFIRMATION_MISMATCH", field: "confirmation", requestId });
    }
    if (String(user.role || "").toLowerCase() === "owner") {
      return res.status(409).json({ error: "پیش از حذف، باید مالکیت حساب اصلی برنامه منتقل شود.", code: "OWNER_TRANSFER_REQUIRED", requestId });
    }
    if (user.password_set === false || !user.password) {
      return res.status(409).json({ error: "پیش از حذف، برای حساب خود رمز عبور تنظیم کنید تا بتوان هویت شما را دوباره تأیید کرد.", code: "PASSWORD_REQUIRED_FOR_DELETION", requestId });
    }
    const password = String(req.body?.password || "");
    if (!password || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "رمز عبور فعلی نادرست است.", code: "REAUTHENTICATION_FAILED", field: "password", requestId });
    }

    const recurring = (await db.query(
      `SELECT DISTINCT payment_subscription_id
         FROM user_premium_entitlements
        WHERE user_id=$1
          AND source='paid_subscription'
          AND auto_renew=true
          AND status IN ('active','scheduled','paused')
          AND revoked_at IS NULL`,
      [user.id],
    )).rows
      .map((row: any) => String(row.payment_subscription_id || ""))
      .filter((id: string) => /^sub_[a-zA-Z0-9]+$/.test(id));
    if (recurring.length && !process.env.STRIPE_SECRET_KEY) {
      return res.status(409).json({
        error: "لغو خودکار اشتراک تمدیدشونده شما ممکن نشد. پیش از حذف حساب با پشتیبانی تماس بگیرید.",
        code: "SUBSCRIPTION_CANCELLATION_UNAVAILABLE",
        requestId,
      });
    }
    for (const subscriptionId of recurring) {
      const stripeResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      });
      if (!stripeResponse.ok && stripeResponse.status !== 404) {
        const stripeError = await stripeResponse.text();
        console.error("Account deletion subscription cancellation failed", {
          requestId,
          userId: user.id,
          subscriptionId,
          status: stripeResponse.status,
          detail: stripeError.slice(0, 300),
        });
        return res.status(502).json({ error: "لغو اشتراک شما ممکن نشد. حساب شما حذف نشده است.", code: "SUBSCRIPTION_CANCELLATION_FAILED", requestId });
      }
    }

    const fileRows = (await db.query("SELECT url FROM files WHERE user_id=$1", [user.id])).rows;
    const sessionRows = (await db.query("SELECT id FROM sessions WHERE user_id=$1", [user.id])).rows;
    if (!process.env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required for account reference hashing.");
    const accountReferenceHash = crypto
      .createHmac("sha256", process.env.ENCRYPTION_KEY)
      .update(String(user.id))
      .digest("hex");
    const audit = await db.withTransaction(async (client) => {
      const counts = (await client.query(
        `SELECT
          (SELECT COUNT(*)::int FROM novels WHERE author_id=$1) AS novels,
          (SELECT COUNT(*)::int FROM chapters c JOIN novels n ON n.id=c.novel_id WHERE n.author_id=$1) AS chapters,
          ((SELECT COUNT(*)::int FROM reviews WHERE user_id=$1)
            + (SELECT COUNT(*)::int FROM chapter_comments WHERE user_id=$1)) AS comments`,
        [user.id],
      )).rows[0];
      const detachedOrders = await client.query(
        `UPDATE premium_orders
            SET account_reference_hash=$2, user_id=NULL, provider_payload=NULL
          WHERE user_id=$1`,
        [user.id, accountReferenceHash],
      );
      await client.query("UPDATE reviews SET username='خواننده حذف‌شده' WHERE user_id=$1", [user.id]);
      await client.query(
        `UPDATE user_premium_entitlements
            SET status='cancelled', revoked_at=COALESCE(revoked_at,timezone('utc'::text,now())), auto_renew=false
          WHERE user_id=$1`,
        [user.id],
      );
      const deletion = await client.query("DELETE FROM users WHERE id=$1", [user.id]);
      if (deletion.rowCount !== 1) throw new Error("The account no longer exists.");
      await client.query(
        `INSERT INTO account_deletion_audit(id,account_reference_hash,deleted_novels,deleted_chapters,deleted_comments,detached_financial_records)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [`ada-${uuidv4()}`, accountReferenceHash, counts.novels, counts.chapters, counts.comments, detachedOrders.rowCount || 0],
      );
      return { novels: counts.novels, chapters: counts.chapters, comments: counts.comments };
    });
    await invalidateNovelCaches();

    for (const session of sessionRows) {
      await supabase.from("settings").delete().eq("setting_key", `session_meta_${session.id}`).catch(() => {});
    }
    const uploadRoot = path.resolve(process.cwd(), "uploads");
    const storedUrls = [...fileRows.map((row: any) => String(row.url || "")), String(user.avatar || "")];
    for (const storedUrl of storedUrls) {
      if (!storedUrl.startsWith("/uploads/")) continue;
      const resolved = path.resolve(uploadRoot, storedUrl.slice("/uploads/".length));
      if (!resolved.startsWith(uploadRoot + path.sep)) continue;
      await fs.promises.unlink(resolved).catch((error: any) => {
        if (error?.code !== "ENOENT") console.error("Deleted account file cleanup failed", { requestId, path: storedUrl, code: error?.code, message: error?.message });
      });
    }
    res.clearCookie("sessionId", { sameSite: "strict" });
    res.clearCookie("session_token", { sameSite: "strict" });
    res.clearCookie("XSRF-TOKEN", { sameSite: "strict" });
    console.info("Account deletion completed", { requestId, deletedNovels: audit.novels, deletedChapters: audit.chapters, deletedComments: audit.comments, subscriptionsCancelled: recurring.length });
    return res.json({ success: true, message: "حساب شما و داده‌های شخصی‌تان حذف شدند.", requestId });
  } catch (error: any) {
    console.error("Account deletion failed", {
      requestId,
      message: error?.message || String(error),
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
    });
    return res.status(409).json({ error: "حساب به‌صورت ایمن حذف نشد. هیچ حذف ناقصی ثبت نشده است.", code: error?.code || "ACCOUNT_DELETION_FAILED", requestId });
  }
});

async function createTwofaSetup(req: express.Request, res: express.Response) {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    if (user.twofa_enabled === true || user.twofa_enabled === 1) {
      return res.status(400).json({ error: 'احراز هویت دومرحله‌ای از قبل فعال است.' });
    }

    let otplib: any;
    try { otplib = await import('otplib'); } catch (e) { return res.status(400).json({ error: 'کتابخانه 2FA نصب نشده است (npm i otplib)' }); }
    const secret = otplib.authenticator.generateSecret();
    const pending = await saveTwofaPendingSecret(user.id, secret);
    const otpauth = otplib.authenticator.keyuri(user.username, 'رپتوک', secret);
    res.json({ setupId: pending.id, secret, otpauth, expiresAt: pending.expiresAt });
  } catch (e) { res.status(400).json({ error: 'ایجاد راه‌اندازی 2FA انجام نشد' }); }
}

// 2FA (TOTP) setup / enable / disable
router.post('/auth/2fa/setup', sensitiveLimiter, createTwofaSetup);
router.get('/auth/2fa/setup', sensitiveLimiter, createTwofaSetup);

router.post('/auth/2fa/cancel', sensitiveLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    await supabase.from('settings').delete().eq('setting_key', twofaPendingSettingsKey(user.id));
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'لغو راه‌اندازی 2FA انجام نشد' });
  }
});

router.post('/auth/2fa/enable', [sensitiveLimiter], async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    if (user.twofa_enabled === true || user.twofa_enabled === 1) {
      return res.status(400).json({ error: 'احراز هویت دومرحله‌ای از قبل فعال است.' });
    }

    const token = sanitizePlainText(req.body?.token, 16).replace(/\D/g, "");
    if (!/^\d{6}$/.test(token)) return res.status(400).json({ error: 'کد 6 رقمی اپلیکیشن احراز هویت را وارد کنید.' });

    const pending = await loadTwofaPendingSecret(user.id);
    if (!pending?.secret) return res.status(400).json({ error: 'راه‌اندازی 2FA منقضی شده است. دوباره شروع کنید.' });

    let otplib: any;
    try { otplib = await import('otplib'); } catch (e) { return res.status(400).json({ error: 'کتابخانه 2FA نصب نشده است (npm i otplib)' }); }

    const ok = otplib.authenticator.check(token, pending.secret);
    if (!ok) {
      await recordTwofaPendingFailure(user.id, pending);
      return res.status(400).json({ error: 'کد وارد شده نامعتبر است' });
    }

    const enc = encrypt(pending.secret);
    await supabase.from('settings').upsert({ setting_key: twofaSettingsKey(user.id), setting_value: enc, updated_at: new Date().toISOString() });
    await supabase.from('settings').delete().eq('setting_key', twofaPendingSettingsKey(user.id));
    await supabase.from('users').update({ twofa_enabled: true }).eq('id', user.id);
    await logSecurityEvent(
      SecurityEventType.LOGIN_AWAITING_2FA,
      user.id,
      { action: '2fa_enabled' },
      req
    );
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: 'فعال‌سازی 2FA انجام نشد' }); }
});

router.post('/auth/2fa/disable', [otpLimiter], async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const token = sanitizePlainText(req.body?.token, 16).replace(/\D/g, "");
    if (!/^\d{6}$/.test(token)) return res.status(400).json({ error: 'کد 6 رقمی اپلیکیشن احراز هویت را وارد کنید.' });
    const { data: row } = await supabase.from('settings').select('setting_value').eq('setting_key', twofaSettingsKey(user.id)).single();
    if (!row?.setting_value) return res.status(400).json({ error: '2FA فعال نیست' });
    const secretEnc = row.setting_value;
    const secret = decrypt(secretEnc) || secretEnc;
    let otplib: any;
    try { otplib = await import('otplib'); } catch (e) { return res.status(400).json({ error: 'کتابخانه 2FA نصب نشده است (npm i otplib)' }); }
    const ok = otplib.authenticator.check(token, secret);
    if (!ok) return res.status(400).json({ error: 'کد وارد شده نامعتبر است' });
    await supabase.from('settings').delete().eq('setting_key', twofaSettingsKey(user.id));
    await supabase.from('settings').delete().eq('setting_key', twofaPendingSettingsKey(user.id));
    await supabase.from('users').update({ twofa_enabled: false }).eq('id', user.id);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: 'غیرفعال‌سازی 2FA انجام نشد' }); }
});

// ✅ NEW: 2FA OTP Verification during login
router.post('/auth/2fa/verify', [otpLimiter], async (req, res) => {
  try {
    const { otpSessionToken, otp } = req.body;
    
    if (!otpSessionToken || !otp) {
      return res.status(400).json({ error: 'همه فیلدها ارسال نشده‌اند' });
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'قالب کد یکبار مصرف نامعتبر است. باید 6 رقم باشد.' });
    }

    // Verify OTP session exists and not expired. The stored value is the
    // SHA-256 hash of the token (legacy plaintext rows are honored once).
    const otpTokenHash = hashSessionToken(otpSessionToken);
    const { data: hashedSession } = await supabase
      .from('otp_sessions')
      .select('*')
      .eq('session_token', otpTokenHash)
      .single();
    let otpSession: any = hashedSession || null;
    if (!otpSession) {
      const { data: legacySession } = await supabase
        .from('otp_sessions')
        .select('*')
        .eq('session_token', String(otpSessionToken).slice(0, 128))
        .single();
      otpSession = legacySession || null;
      if (otpSession) {
        await supabase.from('otp_sessions').update({ session_token: otpTokenHash }).eq('id', otpSession.id);
      }
    }

    if (!otpSession) {
      return res.status(400).json({ error: 'نشست کد یکبار مصرف منقضی شده یا یافت نشد' });
    }

    const userId = otpSession.user_id;

    if (new Date(otpSession.expires_at) < new Date()) {
      await supabase.from('otp_sessions').delete().eq('id', otpSession.id);
      return res.status(400).json({ error: 'نشست کد یکبار مصرف منقضی شده است' });
    }

    // Get user's 2FA secret
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) {
      return res.status(401).json({ error: 'کاربر یافت نشد' });
    }

    // Get encrypted secret from settings
    const { data: row } = await supabase
      .from('settings')
      .select('setting_value')
      .eq('setting_key', twofaSettingsKey(userId))
      .single();

    if (!row?.setting_value) {
      return res.status(400).json({ error: 'کلید 2FA یافت نشد' });
    }

    // Verify OTP
    let otplib: any;
    try { 
      otplib = await import('otplib'); 
    } catch (e) { 
      return res.status(400).json({ error: 'کتابخانه 2FA نصب نشده است' }); 
    }

    const secretEnc = row.setting_value;
    const secret = decrypt(secretEnc) || secretEnc;

    const isValidOTP = otplib.authenticator.check(otp, secret);
    if (!isValidOTP) {
      // Server-side attempt counter: after 5 wrong codes the pending session
      // is burned, so a stolen session cannot grind TOTP guesses forever.
      const attempts = Number(otpSession.attempts || 0) + 1;
      if (attempts >= 5) {
        await supabase.from('otp_sessions').delete().eq('id', otpSession.id);
      } else {
        await supabase.from('otp_sessions').update({ attempts }).eq('id', otpSession.id);
      }
      await logSecurityEvent(
        SecurityEventType.LOGIN_FAILURE,
        userId,
        { reason: 'Invalid 2FA OTP', attempts },
        req
      );
      return res.status(400).json({ error: 'کد یکبار مصرف نامعتبر است' });
    }

    // ✅ OTP verified - create real session
    const sessionDetails = await createSecureSession(req, res, userId, true);

    // Clean up OTP session
    await supabase.from('otp_sessions').delete().eq('id', otpSession.id);

    // Log successful login
    await logSecurityEvent(
      SecurityEventType.LOGIN_SUCCESS,
      userId,
      { method: '2FA' },
      req
    );

    // Return user data
    const { data: statsEntry } = await supabase
      .from('settings')
      .select('setting_value')
      .eq('setting_key', userStatsKey(user.id))
      .single();

    let stats = { hours_read: 0, chapters_logged: 0, words_authored: 0, user_ranking: "#0" };
    if (statsEntry?.setting_value) {
      try {
        stats = typeof statsEntry.setting_value === 'string' 
          ? JSON.parse(statsEntry.setting_value) 
          : statsEntry.setting_value;
      } catch {}
    }

    stats = { ...stats, ...await getComputedUserRanking(user.id) };
    const clientUser = buildClientUser(user, stats);

    res.json({ success: true, user: clientUser, csrfToken: sessionDetails.csrfToken });
  } catch (err) {
    res.status(400).json({ error: 'تأیید کد یکبار مصرف انجام نشد' });
  }
});

router.post("/auth/update-stats", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    const { data: existingStats } = await supabase.from('settings').select('setting_value').eq('setting_key', userStatsKey(user.id)).single();
    let statsObj = { hours_read: 0, chapters_logged: 0, words_authored: 0, user_ranking: "#0" };
    if (existingStats?.setting_value) {
      try {
        statsObj = typeof existingStats.setting_value === 'string' ? JSON.parse(existingStats.setting_value) : existingStats.setting_value;
      } catch {}
    }

    res.json({
      success: true,
      readOnly: true,
      stats: statsObj,
      message: "آمارها در سرور بر اساس پیشرفت مطالعه و دستاوردها محاسبه می‌شوند."
    });
  } catch (err) {
    res.status(400).json({ error: "به‌روزرسانی آمار انجام نشد." });
  }
});

router.get("/auth/reading-progress", async (req, res) => {
  try {
    await ensureReadingFeatureTables();
    const user = await getActiveUser(req);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    const { data, error } = await supabase
      .from("reading_progress")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      readingProgress: (data || []).map((progress: any) => ({
        novelId: progress.novel_id,
        novelTitle: progress.novel_title,
        novelCover: progress.novel_cover || "",
        novelGenre: progress.novel_genre || "",
        novelAuthor: progress.novel_author || "",
        chapterId: progress.chapter_id,
        chapterTitle: progress.chapter_title || "",
        chapterNumber: progress.chapter_number,
        scrollPercent: Number(progress.scroll_percentage || 0),
        scrollPercentage: Number(progress.scroll_percentage || 0),
        readSeconds: Number(progress.read_seconds || 0),
        completed: !!progress.completed,
        updatedAt: progress.updated_at,
        lastRead: progress.updated_at,
      })),
    });
  } catch (err) {
    return res.status(400).json({ error: "دریافت محل مطالعه انجام نشد." });
  }
});

router.post("/auth/reading-progress", async (req, res) => {
  try {
    await ensureReadingFeatureTables();
    await ensureAnalyticsTables();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    const { novelId, novelTitle, chapterId, chapterNumber, scrollPercentage, readSeconds, source } = req.body;
    const safeNovelId = sanitizePlainText(novelId, 160);
    const safeChapterId = sanitizePlainText(chapterId, 160);
    if (!safeNovelId || !safeChapterId) return res.status(400).json({ error: "هدف مطالعه مشخص نشده است." });

    const { data: novel } = await supabase.from("novels").select("*").eq("id", safeNovelId).single();
    if (!novel || !canUserViewNovel(novel, user)) return res.status(404).json({ error: "رمان یافت نشد." });
    const { data: chapter } = await supabase
      .from("chapters")
      .select("*")
      .eq("id", safeChapterId)
      .eq("novel_id", safeNovelId)
      .single();
    if (!chapter || !isChapterVisibleToUser(chapter, canManageNovel(user, novel))) {
      return res.status(404).json({ error: "فصل یافت نشد." });
    }

    const boundedScroll = Math.max(0, Math.min(Number(scrollPercentage || 0), 100));
    const boundedReadSeconds = Math.max(0, Math.min(Number(readSeconds || 0), 6 * 60 * 60));
    const isCompleted = boundedScroll >= 90;
    const progressId = `p-${user.id}-${safeNovelId}`;
    const { data: previousProgress } = await supabase
      .from("reading_progress")
      .select("completed, read_seconds, chapter_id")
      .eq("user_id", user.id)
      .eq("novel_id", safeNovelId)
      .single();
    const wasCompleted = !!previousProgress?.completed;
    const previousReadSeconds = previousProgress?.chapter_id === safeChapterId ? Number(previousProgress?.read_seconds || 0) : 0;
    // Scroll progress and reading time are separate signals. Foreground time is
    // written exclusively by /analytics/read-session from the mounted reader;
    // deriving it from time between scroll events double-counted sessions and
    // also treated idle/background time as reading.
    const sessionReadSeconds = 0;

    await supabase.from('reading_progress').upsert({
      id: progressId,
      username: user.username,
      user_id: user.id,
      novel_id: safeNovelId,
      novel_title: sanitizePlainText(novelTitle || novel.title, 240),
      novel_cover: novel.cover_url || "",
      novel_genre: novel.genre || "",
      novel_author: novel.author || "",
      chapter_id: safeChapterId,
      chapter_title: chapter.title || "",
      chapter_number: Number(chapterNumber || chapter.chapter_number || 1),
      scroll_percentage: boundedScroll,
      read_seconds: Math.max(previousReadSeconds, boundedReadSeconds),
      completed: previousProgress?.chapter_id === safeChapterId ? wasCompleted || isCompleted : isCompleted,
      updated_at: new Date().toISOString()
    });

    // Automatically update persistent stats for chapters logged & hours read
    try {
      const { data: existingStats } = await supabase.from('settings').select('setting_value').eq('setting_key', userStatsKey(user.id)).single();
      let statsObj = { hours_read: 0, chapters_logged: 0, words_authored: 0, user_ranking: "#0" };
      if (existingStats?.setting_value) {
        try {
          statsObj = typeof existingStats.setting_value === 'string' ? JSON.parse(existingStats.setting_value) : existingStats.setting_value;
        } catch {}
      }

      if (isCompleted && !wasCompleted) {
        statsObj.chapters_logged = (statsObj.chapters_logged || 0) + 1;
      }
      
      const baseRank = 5000;
      const currentChapters = statsObj.chapters_logged;
      const calculatedRank = Math.max(1, baseRank - (currentChapters * 12));
      statsObj.user_ranking = `#${calculatedRank.toLocaleString()}`;

      await supabase.from('settings').upsert({
        setting_key: userStatsKey(user.id),
        setting_value: JSON.stringify(statsObj),
        updated_at: new Date().toISOString()
      });

      // Award Achievements for Readers
      const totalReads = statsObj.chapters_logged;
      if (isCompleted && !wasCompleted) {
        if (totalReads >= 1) await checkAndAwardAchievement(user.id, 'ach_reader_first');
        if (totalReads >= 100) await checkAndAwardAchievement(user.id, 'ach_reader_100');
        if (totalReads >= 1000) await checkAndAwardAchievement(user.id, 'ach_reader_1000');

        const currentLevel = Math.max(1, Number(user.level || 1));
        const rewardXp = Math.max(5, Math.ceil(24 / Math.sqrt(currentLevel)));
        let nextXp = Number(user.xp || 0) + rewardXp;
        let nextLevel = currentLevel;
        let threshold = 100 + Math.pow(nextLevel - 1, 2) * 35;
        while (nextXp >= threshold) {
          nextXp -= threshold;
          nextLevel += 1;
          threshold = 100 + Math.pow(nextLevel - 1, 2) * 35;
        }
        await supabase.from("users").update({ level: nextLevel, xp: Math.floor(nextXp) }).eq("id", user.id);
      }

      const hour = new Date().getHours();
      if (isCompleted && !wasCompleted && hour >= 0 && hour < 4) { // Between midnight and 4 AM
        const midnightCount = await incrementUserCounter(user.id, 'midnight_reads');
        if (midnightCount >= 20) await checkAndAwardAchievement(user.id, 'ach_reader_midnight');
      }

    } catch (e) {
      console.error("Failed to increment read progress stats: ", e);
    }

    const analyticsContext = await buildAnalyticsContext(req);
    const shouldCountNovelView = await recordNovelUniqueView(safeNovelId, user, analyticsContext);
    const alreadyCountedChapterView = await hasCountedChapterView(safeNovelId, safeChapterId, user, analyticsContext);
    const shouldCountChapterView = !alreadyCountedChapterView;

    await supabase.from("reading_sessions").insert({
      id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: user.id,
      novel_id: safeNovelId,
      chapter_id: safeChapterId,
      read_seconds: sessionReadSeconds,
      scroll_percentage: boundedScroll,
      source: sanitizePlainText(source || "reader", 80),
      ...analyticsContext
    });

    await supabase.from("analytics_logs").insert({
      id: `log-read-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      novel_id: safeNovelId,
      chapter_id: safeChapterId,
      viewer_id: user.id,
      action_type: shouldCountNovelView ? "view" : "read_progress",
      read_seconds: sessionReadSeconds,
      scroll_percentage: boundedScroll,
      source: sanitizePlainText(source || "reader", 80),
      ...analyticsContext
    });
    await recordSuggestionStatsEvent(safeNovelId, boundedScroll >= 90 ? "chapter_complete" : "chapter_start", Number(chapterNumber || chapter.chapter_number || 0)).catch(() => {});

    if (!shouldCountNovelView && !shouldCountChapterView) {
      return res.json({ success: true, countedView: false });
    }

    // Increment views using RPC calls for atomic updates (single source of truth)
    const { error: chapterRpcError } = shouldCountChapterView
      ? await supabase.rpc('increment_chapter_views', { row_id: safeChapterId })
      : { error: null };
    
    if (chapterRpcError) {
      console.error('Failed to increment chapter views:', chapterRpcError);
    }

    res.json({ success: true, countedView: shouldCountNovelView, countedChapterView: shouldCountChapterView });
  } catch (err) {
    res.status(400).json({ error: "همگام‌سازی پیشرفت مطالعه انجام نشد." });
  }
});

router.post("/auth/bookmarks", interactionLimiter, async (req, res) => {
  try {
    await ensureBookmarkFeatureTables().catch(() => {});
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    const { novelId, bookmark } = req.body;
    const safeNovelId = sanitizePlainText(novelId, 160);
    if (!safeNovelId) return res.status(400).json({ error: "شناسه رمان مشخص نشده است." });
    const { data: novel } = await supabase.from("novels").select("id, author_id, approved_by, approval_status, title").eq("id", safeNovelId).single();
    if (!novel || !canUserViewNovel(novel, user)) return res.status(404).json({ error: "رمان یافت نشد." });

    const requestedShelf = sanitizePlainText(req.body.shelfStatus || req.body.shelf_status || "plan_to_read", 40);
    const shelfStatus = ["reading", "completed", "dropped", "plan_to_read"].includes(requestedShelf) ? requestedShelf : "plan_to_read";
    let tableSynced = false;

    if (bookmark) {
      const analyticsContext = await buildAnalyticsContext(req);
      const now = new Date().toISOString();
      try {
        await supabase.from('bookmarks').delete().eq('user_id', user.id).eq('novel_id', safeNovelId);
        const bookmarkPayload = await filterPayloadToExistingColumns("bookmarks", {
          id: `bm-${user.id}-${safeNovelId}`,
          user_id: user.id,
          username: user.username,
          novel_id: safeNovelId,
          shelf_status: shelfStatus,
          category_id: req.body.categoryId ? sanitizePlainText(req.body.categoryId, 120) : null,
          notes: req.body.notes ? sanitizePlainText(req.body.notes, 2000) : null,
          visibility: req.body.visibility === "public" ? "public" : "private",
          created_at: now,
          updated_at: now
        });
        const { error: bookmarkError } = await supabase.from('bookmarks').insert(bookmarkPayload);
        if (bookmarkError) throw bookmarkError;
        tableSynced = true;
      } catch (bookmarkError) {
        if (!isBookmarkStorageUnavailable(bookmarkError)) throw bookmarkError;
      }
      await supabase.from('analytics_logs').insert({
        id: `log-bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        novel_id: safeNovelId,
        viewer_id: user.id,
        action_type: "bookmark",
        ...analyticsContext
      }).catch(() => {});
    } else {
      try {
        const { error: deleteError } = await supabase.from('bookmarks').delete().eq('user_id', user.id).eq('novel_id', safeNovelId);
        if (deleteError) throw deleteError;
        tableSynced = true;
      } catch (bookmarkError) {
        if (!isBookmarkStorageUnavailable(bookmarkError)) throw bookmarkError;
      }
    }

    let bIds = tableSynced ? await getUserBookmarkIds(user) : await readBookmarkIdsFromSettings(user);
    if (bookmark) bIds = Array.from(new Set([...bIds, safeNovelId]));
    else bIds = bIds.filter((id) => id !== safeNovelId);
    bIds = await writeBookmarkIdsToSettings(user, bIds);

    if (tableSynced) {
      const { count: novelBookmarkCount } = await supabase
        .from('bookmarks')
        .select('id', { count: 'exact', head: true })
        .eq('novel_id', safeNovelId);
      await supabase.from('novels').update({ bookmarks_count: novelBookmarkCount || 0 }).eq('id', safeNovelId);
      await invalidateNovelCaches(safeNovelId);
    }
    await recordSuggestionStatsEvent(safeNovelId, bookmark ? "library_add" : "remove_from_library").catch(() => {});
    await invalidateSuggestionPreferences(user.id).catch(() => {});
    if (bookmark) {
      if (novel?.author_id && novel.author_id !== user.id) {
        await createUserNotification(
          novel.author_id,
          "novel_bookmarked",
          "رمان به کتابخانه اضافه شد",
          `${user.username} رمان ${novel.title} را به کتابخانه‌اش اضافه کرد.`,
          `/novels/${safeNovelId}`,
          "notify_bookmarks"
        );
      }
    }

    if (bIds.length >= 50) {
      await checkAndAwardAchievement(user.id, 'ach_reader_collector');
    }

    res.json({ success: true, bookmarkedIds: bIds, tableSynced });
  } catch (err: any) {
    const msg = String(err?.message || "");
    res.status(400).json({ error: msg && /[\u0600-\u06FF]/.test(msg) && msg.length < 300 ? msg : "همگام‌سازی نشانک انجام نشد." });
  }
});

router.get("/auth/library", async (req, res) => {
  try {
    await ensureBookmarkFeatureTables().catch(() => {});
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    try {
      const { data, error } = await supabase
        .from("bookmarks")
        .select("novel_id, shelf_status, category_id, notes, visibility, created_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (!error) return res.json({ items: data || [] });
      if (!isBookmarkStorageUnavailable(error)) throw error;
    } catch (error) {
      if (!isBookmarkStorageUnavailable(error)) throw error;
    }

    const ids = await readBookmarkIdsFromSettings(user);
    res.json({
      items: ids.map((id) => ({
        novel_id: id,
        shelf_status: "plan_to_read",
        category_id: null,
        notes: null,
        visibility: "private",
        created_at: null,
        updated_at: null
      }))
    });
  } catch {
    res.status(400).json({ error: "بارگذاری کتابخانه انجام نشد." });
  }
});

router.patch("/auth/library/:novelId", async (req, res) => {
  try {
    await ensureBookmarkFeatureTables().catch(() => {});
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    const novelId = sanitizePlainText(req.params.novelId, 160);
    const requestedShelf = sanitizePlainText(req.body.shelfStatus || req.body.shelf_status, 40);
    const shelfStatus = requestedShelf
      ? (["reading", "completed", "dropped", "plan_to_read"].includes(requestedShelf) ? requestedShelf : null)
      : undefined;
    if (requestedShelf && !shelfStatus) return res.status(400).json({ error: "وضعیت قفسه نامعتبر است." });
    if (req.body.visibility !== undefined && !["private", "public"].includes(req.body.visibility)) {
      return res.status(400).json({ error: "سطح نمایش نشانک نامعتبر است." });
    }

    const { data: novel } = await supabase.from("novels").select("id, author_id, approved_by, approval_status").eq("id", novelId).single();
    if (!novel || !canUserViewNovel(novel, user)) return res.status(404).json({ error: "رمان یافت نشد." });

    const now = new Date().toISOString();
    try {
      const { data: existingBookmark } = await supabase
        .from("bookmarks")
        .select("shelf_status, category_id, notes, visibility, created_at")
        .eq("user_id", user.id)
        .eq("novel_id", novelId)
        .single();
      await supabase.from("bookmarks").delete().eq("user_id", user.id).eq("novel_id", novelId);
      const payload = await filterPayloadToExistingColumns("bookmarks", {
        id: `bm-${user.id}-${novelId}`,
        user_id: user.id,
        username: user.username,
        novel_id: novelId,
        shelf_status: shelfStatus || existingBookmark?.shelf_status || "plan_to_read",
        category_id: req.body.categoryId !== undefined
          ? (req.body.categoryId ? sanitizePlainText(req.body.categoryId, 120) : null)
          : existingBookmark?.category_id || null,
        notes: req.body.notes !== undefined
          ? (req.body.notes ? sanitizePlainText(req.body.notes, 2000) : null)
          : existingBookmark?.notes || null,
        visibility: req.body.visibility !== undefined
          ? (req.body.visibility === "public" ? "public" : "private")
          : (existingBookmark?.visibility === "public" ? "public" : "private"),
        created_at: existingBookmark?.created_at || now,
        updated_at: now
      });
      const { error } = await supabase.from("bookmarks").insert(payload);
      if (error) throw error;

      const { data: items } = await supabase
        .from("bookmarks")
        .select("novel_id, shelf_status, category_id, notes, visibility, created_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      await writeBookmarkIdsToSettings(user, (items || []).map((item: any) => item.novel_id));
      await invalidateSuggestionPreferences(user.id).catch(() => {});
      return res.json({ success: true, items: items || [] });
    } catch (error) {
      if (!isBookmarkStorageUnavailable(error)) throw error;
      const ids = await readBookmarkIdsFromSettings(user);
      const nextIds = ids.includes(novelId) ? ids : [...ids, novelId];
      await writeBookmarkIdsToSettings(user, nextIds);
      return res.json({
        success: true,
        items: nextIds.map((id) => ({
          novel_id: id,
          shelf_status: id === novelId ? shelfStatus : "plan_to_read",
          category_id: id === novelId && req.body.categoryId ? sanitizePlainText(req.body.categoryId, 120) : null,
          notes: id === novelId && req.body.notes ? sanitizePlainText(req.body.notes, 2000) : null,
          visibility: id === novelId && req.body.visibility === "public" ? "public" : "private",
          created_at: null,
          updated_at: id === novelId ? now : null
        }))
      });
    }
  } catch {
    res.status(400).json({ error: "به‌روزرسانی مورد کتابخانه انجام نشد." });
  }
});

router.get("/users/resolve/:username", async (req, res) => {
  try {
    const account = await resolveUsername(req.params.username);
    if (!account) return res.status(404).json({ error: "کاربر یافت نشد." });
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({
      id: account.id,
      username: account.username,
      redirected: !!account.redirected,
      profileUrl: `/authors/${encodeURIComponent(account.username)}`,
    });
  } catch {
    return res.status(400).json({ error: "شناسایی کاربر ممکن نشد." });
  }
});

router.get("/users/:username/bookmarks", async (req, res) => {
  try {
    await ensureBookmarkFeatureTables();
    const username = sanitizePlainText(req.params.username, 80).trim();
    const account = await resolveUsername(username);
    if (!account) return res.status(404).json({ error: "کاربر یافت نشد." });

    const { data, error } = await supabase
      .from("bookmarks")
      .select("novel_id, updated_at")
      .eq("user_id", account.id)
      .eq("visibility", "public")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const ids = (data || []).map((item: any) => item.novel_id).filter(Boolean);
    const { data: publicNovels } = ids.length
      ? await supabase.from("novels").select("id").in("id", ids).eq("approval_status", "approved")
      : { data: [] as any[] };
    const allowedIds = new Set((publicNovels || []).map((novel: any) => novel.id));
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ items: (data || []).filter((item: any) => allowedIds.has(item.novel_id)) });
  } catch {
    res.status(400).json({ error: "بارگذاری نشانک‌های عمومی انجام نشد." });
  }
});

router.get("/auth/bookmark-categories", async (req, res) => {
  try {
    const user = await getActiveUser(req);
    if (!user) return res.json({ categories: [] });
    
    const { data: catData } = await supabase.from('settings').select('setting_value').eq('setting_key', userBookmarkCategoriesKey(user)).single();
    if (catData?.setting_value) {
      const parsed = typeof catData.setting_value === 'string' ? JSON.parse(catData.setting_value) : catData.setting_value;
      const ownedIds = new Set(await getUserBookmarkIds(user));
      const categories = normalizeBookmarkCategories(parsed).map((category: any) => ({
        ...category,
        items: category.items.filter((novelId: string) => ownedIds.has(novelId))
      }));
      res.json({ categories });
    } else {
      res.json({ categories: [] });
    }
  } catch (err) {
    res.json({ categories: [] });
  }
});

router.get("/auth/novels/:id/editor-messages", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { id } = req.params;
    const { data: nvl } = await supabase.from('novels').select('author_id, approved_by').eq('id', id).single();
    if (!canManageNovel(user, nvl)) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    const { data: msgs } = await supabase.from('editor_messages').select('*').eq('novel_id', id).order('created_at', { ascending: true });
    
    const mapped = msgs?.map(m => ({
      ...m,
      is_editor: m.sender_id !== user.id
    })) || [];
    
    res.json(mapped);
  } catch (err) {
    res.status(400).json({ error: "دریافت پیام‌ها انجام نشد" });
  }
});

router.post("/auth/novels/:id/editor-messages", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { id } = req.params;
    const { content } = req.body;
    
    const { data: nvl } = await supabase.from('novels').select('author_id, approved_by').eq('id', id).single();
    if (!nvl) return res.status(404).json({ error: "یافت نشد" });
    if (nvl.author_id !== user.id) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    let receiverId = nvl.approved_by;
    if (!receiverId) {
      const { data: owner } = await supabase.from('users').select('id').ilike('role', 'owner').limit(1).single();
      receiverId = owner?.id || user.id;
    }

    await supabase.from('editor_messages').insert({
      id: "edmsg-auth-" + Date.now() + Math.random().toString(36).substr(2,5),
      novel_id: id,
      sender_id: user.id,
      receiver_id: receiverId,
      content: sanitizePlainText(String(content || ""), 10000)
    });

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ارسال پیام انجام نشد" });
  }
});

router.post("/auth/bookmark-categories", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    
    const ownedIds = new Set(await getUserBookmarkIds(user));
    const normalizedCategories = normalizeBookmarkCategories(req.body.categories || []).map((category: any) => ({
      ...category,
      items: category.items.filter((novelId: string) => ownedIds.has(novelId))
    }));
    await supabase.from('settings').upsert({
      setting_key: userBookmarkCategoriesKey(user),
      setting_value: JSON.stringify(normalizedCategories)
    });
    res.json({ success: true, categories: normalizedCategories });
  } catch (err) {
    res.status(400).json({ error: "همگام‌سازی دسته‌ها انجام نشد." });
  }
});

router.post("/auth/notes/:chapterId", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    // ✅ SECURITY (M-2): Validate chapterId format before using it as a
    // settings key. Without this, an attacker could send a 1MB chapterId
    // and bloat the settings table.
    const rawChapterId = String(req.params.chapterId || "").slice(0, 120);
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(rawChapterId)) {
      return res.status(400).json({ error: "شناسه فصل نامعتبر است." });
    }

    // ✅ SECURITY (M-2): Sanitize and bound the note length to prevent
    // storage DoS. 10,000 characters is plenty for a chapter note.
    const rawNote = req.body?.note;
    const note = typeof rawNote === "string"
      ? sanitizeHtml(rawNote, { allowedTags: [], allowedAttributes: {} }).slice(0, 10000)
      : "";

    await supabase.from('settings').upsert({ 
      setting_key: userChapterNoteKey(user.id, rawChapterId),
      setting_value: note
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ذخیره یادداشت فصل انجام نشد." });
  }
});

router.get("/auth/notes/:chapterId", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!user) return res.json({ note: "" });

    // ✅ SECURITY (M-2): Same validation as POST to prevent key injection.
    const rawChapterId = String(req.params.chapterId || "").slice(0, 120);
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(rawChapterId)) {
      return res.status(400).json({ error: "شناسه فصل نامعتبر است." });
    }

    const { data: noteData } = await supabase.from('settings').select('setting_value').eq('setting_key', userChapterNoteKey(user.id, rawChapterId)).single();
    
    res.json({ note: noteData?.setting_value || "" });
  } catch (err) {
    res.json({ note: "" });
  }
});


router.post("/auth/messages/read", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    const { id, readAll } = req.body;
    if (readAll) {
      await supabase.from('messages').update({ is_read: 1 }).eq('recipient_id', user.id);
    } else if (id) {
      await supabase.from('messages').update({ is_read: 1 }).eq('recipient_id', user.id).eq('id', id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "همگام‌سازی پیام‌ها انجام نشد." });
  }
});

router.post("/auth/notifications/read", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    await ensureNotificationTable();

    const { id, readAll } = req.body;
    if (readAll) {
      await supabase.from('notifications').update({ is_read: 1 }).eq('user_id', user.id);
    } else if (id) {
      await supabase.from('notifications').update({ is_read: 1 }).eq('user_id', user.id).eq('id', id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "علامت‌گذاری اعلان‌ها به‌عنوان خوانده‌شده انجام نشد." });
  }
});

router.get("/auth/preferences", async (req, res) => {
  try {
    const user = await getActiveUser(req);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    
    const { data: prefData } = await supabase.from('settings').select('setting_value').eq('setting_key', userPreferencesKey(user.id)).single();
    if (prefData?.setting_value) {
      const parsed = typeof prefData.setting_value === 'string' ? JSON.parse(prefData.setting_value) : prefData.setting_value;
      res.json({ preferences: parsed });
    } else {
      res.json({ preferences: { subgenres: [] } });
    }
  } catch (err) {
    res.json({ preferences: { subgenres: [] } });
  }
});

// ✅ SECURITY (M-3): Import zod at the top of server/api/index.ts
// (add this near the other imports at the top of the file):
// import { z } from 'zod';
//
// Then add this schema before the /auth/preferences route:

const preferencesSchema = z.object({
  subgenres: z.array(z.string().max(80)).max(50).optional(),
  readingGoals: z.object({
    dailyChapters: z.number().int().min(0).max(100).optional(),
    weeklyHours: z.number().min(0).max(168).optional(),
  }).strict().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  font: z.enum(["estedad", "vazirmatn", "sans", "serif", "mono"]).optional(),
  fontSize: z.number().int().min(12).max(32).optional(),
  lineHeight: z.number().min(1).max(3).optional(),
  textAlign: z.enum(["justify", "left", "center", "right"]).optional(),
  // Allow up to 10 additional string-keyed fields with string values for
  // forward compatibility, but bound the total object size.
  }).strict().catchall(z.union([z.string().max(500), z.number(), z.boolean(), z.null()]));

router.post("/auth/preferences", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });

    // ✅ SECURITY (M-3): Validate preferences against schema before persisting.
    const parsed = preferencesSchema.safeParse(req.body.preferences || {});
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "تنظیمات نامعتبر است.",
        details: parsed.error.issues?.map((i: any) => ({ field: i.path.join('.'), message: i.message }))?.slice(0, 5),
      });
    }

    // ✅ SECURITY (M-3): Hard cap on serialized size (50KB) as a final safety net.
    const serialized = JSON.stringify(parsed.data);
    if (serialized.length > 50_000) {
      return res.status(400).json({ error: "حجم تنظیمات بیش از حد مجاز است." });
    }
    
    await supabase.from('settings').upsert({
      setting_key: userPreferencesKey(user.id),
      setting_value: serialized
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ذخیره تنظیمات انجام نشد." });
  }
});

router.get("/auth/notifications-prefs", async (req, res) => {
  try {
    const user = await getActiveUser(req);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    
    await ensureNotificationTable();
    const { data: userRecord } = await supabase.from('users').select('notify_comments, notify_ratings, notify_defaults, notify_likes, notify_replies, notify_logins, notify_followers, notify_bookmarks').eq('id', user.id).single();
    
    res.json({
       notify_comments: userRecord?.notify_comments ?? true,
       notify_ratings: userRecord?.notify_ratings ?? true,
       notify_defaults: userRecord?.notify_defaults ?? true,
       notify_followers: userRecord?.notify_followers ?? true,
       notify_likes: userRecord?.notify_likes ?? true,
       notify_bookmarks: userRecord?.notify_bookmarks ?? true,
       notify_replies: userRecord?.notify_replies ?? true,
       notify_logins: userRecord?.notify_logins ?? true
    });
  } catch (err) {
    res.json({});
  }
});

router.post("/auth/notifications-prefs", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    
    await ensureNotificationTable();
    const allowed = ["notify_comments", "notify_ratings", "notify_defaults", "notify_likes", "notify_replies", "notify_logins", "notify_followers", "notify_bookmarks"];
    const updates = Object.fromEntries(allowed.filter((key) => typeof req.body[key] === "boolean").map((key) => [key, req.body[key]]));
    await supabase.from('users').update(updates).eq('id', user.id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ذخیره تنظیمات انجام نشد." });
  }
});

router.use("/forums", forumsRouter);
router.use("/achievements", achievementsRouter);
router.use("/notifications", notificationsRouter);
router.use("/support", supportRouter);
router.use("/files", uploadRouter);
router.use("/upload", uploadRouter);
router.use("/suggestion", suggestionRouter);
router.use("/discussion", postsRouter);
router.use("/editor", editorRouter);
router.use("/posts", postsRouter);
router.use("/analytics", analyticsRouter);
router.use("/follows", analyticsRouter); // Reusing analytics file for follows for simplicity since it exported in it
router.use("/admin", premiumManagementRouter);
router.use("/admin", adminRouter);
router.use("/admin", (_req, _res, next) => {
  // Legacy admin routes are still declared below, so allow fallthrough before the final API 404.
  next();
});
router.use("/ai", aiRouter);
router.use("/auth/messages", messagesRouter);
router.use("/contests", contestsRouter);
router.use("/events", eventsRouter);
router.use("/challenges", challengesRouter);
router.use("/exchange", exchangeRouter);
router.use("/worldbuilding", worldbuildingRouter);
// Manga page endpoints live beneath the novel they belong to:
// /api/novels/:novelId/chapters/:chapterId/pages. Declared before the
// single-segment novel routes below, which cannot match these paths.
router.use("/novels", mangaRouter);

router.get("/users/:userId/xp", async (req, res) => {
  try {
    const { userId } = req.params;
    const { data: history } = await supabase.from('users_xp').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    const { data: user } = await supabase.from('users').select('xp, level').eq('id', userId).single();
    res.json({ success: true, xp: user?.xp || 0, level: user?.level || 1, history: history || [] });
  } catch (err) {
    res.status(400).json({ error: "بارگذاری تاریخچه XP انجام نشد." });
  }
});

router.get("/writer/novel-stats", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    // Engagement roll-up per authored novel. Counts are computed from the
    // authoritative tables so cached counters can never drift from reality.
    const { rows } = await db.query(
      `SELECT n.id, n.title, n.cover_url, n.views_count, n.rating,
              (SELECT COUNT(*) FROM novel_likes nl WHERE nl.novel_id = n.id)::int AS likes_count,
              (SELECT COUNT(*) FROM chapter_comments cc
                WHERE cc.novel_id = n.id AND cc.deleted_at IS NULL
                  AND cc.moderation_status = 'visible')::int AS comments_count,
              (SELECT COUNT(*) FROM reviews r WHERE r.novel_id = n.id)::int AS reviews_count,
              COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.novel_id = n.id), 0)::float AS avg_rating
         FROM novels n
        WHERE n.author_id = $1
        ORDER BY n.updated_at DESC NULLS LAST`,
      [user.id]
    );
    res.json({ stats: rows.map((row: any) => ({
      novelId: String(row.id),
      title: String(row.title || "بدون عنوان"),
      coverUrl: row.cover_url || "",
      viewsCount: Number(row.views_count || 0),
      likesCount: Number(row.likes_count || 0),
      commentsCount: Number(row.comments_count || 0),
      reviewsCount: Number(row.reviews_count || 0),
      avgRating: Number(row.avg_rating || 0),
      totalEngagement: Number(row.likes_count || 0) + Number(row.comments_count || 0) + Number(row.reviews_count || 0),
    })) });
  } catch (error: any) {
    console.error("Writer novel stats failed", { userId: req.params, message: error?.message, code: error?.code });
    res.status(400).json({ error: "بارگذاری آمار رمان‌ها انجام نشد." });
  }
});

router.get("/novels", async (req, res) => {
  try {
    await publishDueScheduledChapters();
    const user = await getActiveUser(req, false);
    const isCatalogueView = req.query.view === "catalog";
    const cacheKey = catalogCacheKey(user, isCatalogueView ? "catalog" : "full");
    const cachedNovels = await sharedCache.get<any[]>(cacheKey);
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
    res.setHeader("Vary", "Cookie");
    if (cachedNovels) return res.json(cachedNovels);
    
    let dbQuery = supabase.from('novels').select('*').order('created_at', { ascending: false });
    const { data: novelsList, error } = await dbQuery;
    if (error) throw error;
    
    const filteredNovels = (novelsList || []).filter(novel => canUserViewNovel(novel, user));
    if (filteredNovels.length === 0) {
      return res.json([]);
    }

    // Batch load all related data instead of N+1 queries
    const novelIds = filteredNovels.map(n => n.id);
    
    const [{ data: allChapters }, { data: allReviews }, novelLikesResult, chapterLikesResult] = await Promise.all([
      supabase.from('chapters')
        .select(await chapterSelectColumns(isCatalogueView ? "catalog" : "full"))
        .in('novel_id', novelIds)
        .order('order_index', { ascending: true }),
      supabase.from('reviews')
        .select(isCatalogueView
          ? 'id, novel_id, rating'
          : 'id, novel_id, user_id, username, rating, rating_overall, rating_style, rating_story, rating_grammar, rating_character, content, created_at')
        .in('novel_id', novelIds)
        .order('created_at', { ascending: false }),
      supabase.from('novel_likes')
        .select('novel_id')
        .in('novel_id', novelIds),
      db.query(
        `SELECT novel_id, chapter_id, count(*)::int AS likes_count,
                COALESCE(bool_or(user_id=$2), false) AS liked_by_viewer
           FROM chapter_likes
          WHERE novel_id=ANY($1::text[])
          GROUP BY novel_id, chapter_id`,
        [novelIds, String(user?.id || "")],
      ),
    ]);

    const novelLikesMap: Record<string, number> = {};
    (novelLikesResult?.data || []).forEach((like: any) => {
      if (!like || !like.novel_id) return;
      novelLikesMap[like.novel_id] = (novelLikesMap[like.novel_id] || 0) + 1;
    });
    const chapterLikesMap: Record<string, { likesCount: number; likedByCurrentUser: boolean }> = {};
    const chapterLikesByNovel: Record<string, number> = {};
    (chapterLikesResult.rows || []).forEach((like: any) => {
      const chapterId = String(like.chapter_id || "");
      const novelId = String(like.novel_id || "");
      const likesCount = Number(like.likes_count || 0);
      if (chapterId) chapterLikesMap[chapterId] = { likesCount, likedByCurrentUser: like.liked_by_viewer === true };
      if (novelId) chapterLikesByNovel[novelId] = (chapterLikesByNovel[novelId] || 0) + likesCount;
    });

    // Create maps for fast lookup
    const chaptersMap: Record<string, any[]> = {};
    const reviewsMap: Record<string, any[]> = {};
    
    (allChapters || []).forEach(ch => {
      if (!chaptersMap[ch.novel_id]) chaptersMap[ch.novel_id] = [];
      chaptersMap[ch.novel_id].push(ch);
    });
    
    // Catalogue cards only need the count/rating. Shipping every review body
    // and identity on first paint made mobile JSON parsing and React hydration
    // needlessly expensive; the full novel endpoint restores them on open.
    const hydratedReviews = isCatalogueView ? (allReviews || []) : await hydrateReviewIdentities(allReviews || []);
    hydratedReviews.forEach(rv => {
      if (!reviewsMap[rv.novel_id]) reviewsMap[rv.novel_id] = [];
      reviewsMap[rv.novel_id].push(rv);
    });

    const [authorMaps, premiumAuthorIds] = await Promise.all([
      buildNovelAuthorIdentityMaps(filteredNovels),
      getActiveWriterPremiumUserIds(filteredNovels.map((novel: any) => String(novel.author_id || ""))),
    ]);
    const hydratedNovels = filteredNovels.map(novel => {
      const canManage = canManageNovel(user, novel);
      const chapters = (chaptersMap[novel.id] || []).filter((chapter: any) => isChapterVisibleToUser(chapter, canManage));
      const publicChapters = (chaptersMap[novel.id] || []).filter((chapter: any) => isChapterVisibleToUser(chapter, false));
      const reviews = reviewsMap[novel.id] || [];
      const likesCount = Number(novelLikesMap[novel.id] || 0) + Number(chapterLikesByNovel[novel.id] || 0);
      const authorIdentity = getNovelAuthorIdentity(novel, authorMaps);
      const savedPremiumPresentation = sanitizePremiumPresentation(novel.premium_presentation);
      const premiumPresentationActive = savedPremiumPresentation.enabled && premiumAuthorIds.has(String(novel.author_id || ""));

      const mainCategories = sanitizeTaxonomyList(Array.isArray(novel.main_categories) ? novel.main_categories : []);
      const subCategories = sanitizeTaxonomyList(Array.isArray(novel.sub_categories) ? novel.sub_categories : []);
      const warnings = sanitizeTaxonomyList(Array.isArray(novel.warnings) ? novel.warnings : []);
      const tags = sanitizeTaxonomyList(Array.isArray(novel.tags) ? novel.tags : []);
      const characters = isCatalogueView ? [] : (Array.isArray(novel.characters) ? novel.characters : []);

      return {
        id: novel.id, title: novel.title, author: novel.author || authorIdentity.username, author_id: novel.author_id, authorUsername: authorIdentity.username || novel.author, authorAvatar: authorIdentity.avatar || "", authorDisplayName: novel.author || authorIdentity.displayName, cover: isCatalogueView ? catalogueCoverUrl(novel) : novel.cover_url, coverUrl: isCatalogueView ? catalogueCoverUrl(novel) : novel.cover_url, description: novel.description, rating: ratingForReviewCount(novel.rating, reviews.length), status: novel.status, approvalStatus: novel.approval_status || 'pending_approval', editorNote: novel.editor_note || '', genre: novel.genre, createdAt: novel.created_at, updatedAt: novel.updated_at || novel.created_at, reviewsCount: reviews.length, wordsCount: (chapters || []).reduce((acc: number, c: any) => acc + (c.word_count || 0), 0) || novel.words_count, viewsCount: Number(novel.views_count || 0), publishedChapterCount: publicChapters.filter((c: any) => c.is_auxiliary !== true).length, averageViews: calculateAverageViews(novel.views_count, publicChapters.filter((c: any) => c.is_auxiliary !== true).length), bookmarksCount: Number(novel.bookmarks_count || 0), likesCount: Number(likesCount || 0), isCompleted: novel.is_completed === 1 || novel.is_completed === true, characters, mainCategories, subCategories, warnings, tags, ageRating: novel.age_rating || "PG-13", preventCopy: novel.prevent_copy === true, preventScreenshot: novel.prevent_screenshot === true, premiumPresentation: premiumPresentationActive || canManage ? savedPremiumPresentation : { ...savedPremiumPresentation, enabled: false }, premiumPresentationActive, contentKind: normalizeContentKind(novel.content_kind), readingDirection: normalizeReadingDirection(novel.reading_direction), catalogueOnly: isCatalogueView, chapters: (chapters || []).map((c: any) => ({ id: c.id, novelId: novel.id, title: c.title, content: isCatalogueView ? "" : (c.content || ""), chapterNumber: c.chapter_number || ((c.order_index || 0) + 1), isAuxiliary: c.is_auxiliary === true, createdAt: c.created_at, updatedAt: c.updated_at || c.published_at || c.created_at, wordCount: c.word_count, authorNotesTop: isCatalogueView ? "" : c.author_notes_top || "", authorNotesBottom: isCatalogueView ? "" : (c.author_notes_bottom || ""), status: c.status || "Published", editorialStatus: c.editorial_status || "draft", moderationStatus: c.moderation_status || "visible", assignedEditorId: c.assigned_editor_id || null, reviewDueAt: c.review_due_at || null, scheduledAt: c.scheduled_at || undefined, publishedAt: c.published_at || undefined, viewsCount: c.views_count || 0, pageCount: Number(c.page_count || 0), preventCopy: c.prevent_copy === true, preventScreenshot: c.prevent_screenshot === true, likesCount: chapterLikesMap[c.id]?.likesCount || 0, likedByCurrentUser: chapterLikesMap[c.id]?.likedByCurrentUser || false, editor_note: c.editor_note || "", editorNote: c.editor_note || "" })), reviews: isCatalogueView ? [] : (reviews || []).map(mapReviewToClient), isAIGenerated: novel.is_ai_generated === true, isAIAssisted: novel.is_ai_assisted === true
      };
    });

    await sharedCache.set(cacheKey, hydratedNovels, 5 * 60);
    res.json(hydratedNovels);
  } catch (err) {
    res.status(400).json({ error: "دریافت فهرست رمان‌ها انجام نشد." });
  }
});

router.get("/novels/search", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const normalizedRole = String(user?.role || "").toLowerCase().trim();
    const isModerator = user && (normalizedRole === 'owner' || normalizedRole === 'publisher' || normalizedRole === 'editor');
    const query = sanitizePlainText(req.query.q, 120).trim();
    const genre = sanitizePlainText(req.query.genre, 80).trim();
    const status = sanitizePlainText(req.query.status, 40).trim();
    const ageRating = sanitizePlainText(req.query.ageRating || req.query.age_rating, 20).trim();
    const tag = sanitizePlainText(req.query.tag, 80).trim().toLowerCase();
    const warning = sanitizePlainText(req.query.warning, 120).trim().toLowerCase();
    const mainCategory = sanitizePlainText(req.query.mainCategory || req.query.main_category || req.query.category, 100).trim().toLowerCase();
    const subCategory = sanitizePlainText(req.query.subCategory || req.query.sub_category || req.query.subGenre || req.query.sub_genre, 100).trim().toLowerCase();
    const completed = sanitizePlainText(req.query.completed, 10).trim();
    const origin = sanitizePlainText(req.query.origin || req.query.originType, 20).trim().toLowerCase();
    const minRating = Number(req.query.minRating || req.query.min_rating || 0);
    const minChapters = Number(req.query.minChapters || req.query.min_chapters || 0);
    const minViews = Number(req.query.minViews || req.query.min_views || 0);
    const sort = sanitizePlainText(req.query.sort, 40).trim();
    if (!query && !genre && !status && !ageRating && !tag && !warning && !mainCategory && !subCategory && !completed && !origin && !minRating && !minChapters && !minViews) return res.json([]);

    const safeQuery = normalizeFacet(query);
    const queryTokens = searchTokens(safeQuery);
    let dbSearch = supabase
      .from('novels')
      .select('*')
      .eq('approval_status', 'approved');
    if (status) dbSearch = dbSearch.eq("status", status);
    if (ageRating) dbSearch = dbSearch.eq("age_rating", ageRating);
    if (minRating > 0) dbSearch = dbSearch.gte("rating", minRating);
    if (minViews > 0) dbSearch = dbSearch.gte("views_count", minViews);
    if (completed === "true") dbSearch = dbSearch.eq("is_completed", true);
    if (completed === "false") dbSearch = dbSearch.eq("is_completed", false);

    const { data: novelsList, error } = await dbSearch.order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    const candidateIds = (novelsList || []).map((novel: any) => novel.id);
    const chapterCounts: Record<string, number> = {};
    if (candidateIds.length > 0) {
      const { data: chaptersForCounts } = await supabase.from("chapters").select("novel_id, status, moderation_status, scheduled_at, published_at").in("novel_id", candidateIds);
      (chaptersForCounts || []).forEach((chapter: any) => {
        if (isChapterVisibleToUser(chapter, false)) chapterCounts[chapter.novel_id] = (chapterCounts[chapter.novel_id] || 0) + 1;
      });
    }

    const visible = (novelsList || []).filter((novel: any) => {
      // Apply approval status filtering using helper function
      if (!canUserViewNovel(novel, user)) {
        return false;
      }
      
      // Apply other filters
      const tags = sanitizeTaxonomyList(Array.isArray(novel.tags) ? novel.tags : []).map((item: any) => normalizeFacet(item));
      const warnings = sanitizeTaxonomyList(Array.isArray(novel.warnings) ? novel.warnings : []).map((item: any) => normalizeFacet(item));
      const mainCategories = sanitizeTaxonomyList(Array.isArray(novel.main_categories) ? novel.main_categories : []).map((item: any) => normalizeFacet(item));
      const subCategories = sanitizeTaxonomyList(Array.isArray(novel.sub_categories) ? novel.sub_categories : []).map((item: any) => normalizeFacet(item));
      if (genre && !novelMatchesFacet(novel, genre)) return false;
      if (tag && !tags.includes(normalizeFacet(tag))) return false;
      if (warning && !warnings.includes(normalizeFacet(warning))) return false;
      if (mainCategory && !mainCategories.includes(normalizeFacet(mainCategory))) return false;
      if (subCategory && !subCategories.includes(normalizeFacet(subCategory))) return false;
      if (origin === "translated" && novel.origin_type !== "translated") return false;
      if (origin === "original" && (novel.origin_type || "original") !== "original") return false;
      if (minChapters > 0 && Number(chapterCounts[novel.id] || 0) < minChapters) return false;
      return true;
    }).map((novel: any) => {
      return { novel, relevance: safeQuery ? scoreNovelSearch(novel, safeQuery, queryTokens) : 1 };
    }).filter((wrap: any) => {
      return !safeQuery || wrap.relevance > 0;
    }).sort((aWrap: any, bWrap: any) => {
      const a = aWrap.novel;
      const b = bWrap.novel;
      if (sort === "views") return Number(b.views_count || 0) - Number(a.views_count || 0);
      if (sort === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
      if (sort === "bookmarks") return Number(b.bookmarks_count || 0) - Number(a.bookmarks_count || 0);
      if (sort === "updated") return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
      if (sort === "newest") return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      return bWrap.relevance - aWrap.relevance || new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }).map((wrap: any) => wrap.novel).slice(0, 80);

    const authorMaps = await buildNovelAuthorIdentityMaps(visible);
    res.json(visible.map((novel: any) => {
      const authorIdentity = getNovelAuthorIdentity(novel, authorMaps);
      return ({
      id: novel.id,
      title: novel.title,
      author: novel.author || authorIdentity.username,
      author_id: novel.author_id,
      authorUsername: authorIdentity.username || novel.author,
      authorAvatar: authorIdentity.avatar || "",
      authorDisplayName: novel.author || authorIdentity.displayName,
      cover: novel.cover_url,
      coverUrl: novel.cover_url,
      description: novel.description,
      rating: ratingForReviewCount(novel.rating, novel.reviews_count),
      status: novel.status,
      approvalStatus: novel.approval_status || 'pending_approval',
      genre: novel.genre,
      createdAt: novel.created_at,
      updatedAt: novel.updated_at || novel.created_at,
      reviewsCount: novel.reviews_count || 0,
      wordsCount: novel.words_count || 0,
      viewsCount: novel.views_count || 0,
      publishedChapterCount: chapterCounts[novel.id] || 0,
      averageViews: calculateAverageViews(novel.views_count, chapterCounts[novel.id] || 0),
      bookmarksCount: novel.bookmarks_count || 0,
      likesCount: novel.likes_count || 0,
      isCompleted: novel.is_completed === 1 || novel.is_completed === true,
      tags: sanitizeTaxonomyList(Array.isArray(novel.tags) ? novel.tags : []),
      mainCategories: sanitizeTaxonomyList(Array.isArray(novel.main_categories) ? novel.main_categories : []),
      subCategories: sanitizeTaxonomyList(Array.isArray(novel.sub_categories) ? novel.sub_categories : []),
      warnings: sanitizeTaxonomyList(Array.isArray(novel.warnings) ? novel.warnings : []),
      ageRating: novel.age_rating || "PG-13",
      originType: novel.origin_type === "translated" ? "translated" : "original",
      originalAuthor: novel.original_author || "",
      translators: Array.isArray(novel.translators) ? novel.translators : [],
      chapters: [],
      reviews: []
    });
    }));
  } catch (err) {
    res.status(400).json({ error: "جستجوی رمان‌ها انجام نشد." });
  }
});

router.get("/novels/:id/cover", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const { data: novel } = await supabase.from("novels").select("id, author_id, approval_status, cover_url").eq("id", req.params.id).single();
    if (!novel || !canUserViewNovel(novel, user)) return res.status(404).json({ error: "جلد رمان یافت نشد." });
    const cover = String(novel.cover_url || "");
    const match = cover.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([a-zA-Z0-9+/=]+)$/);
    if (match) {
      const mime = match[1] === "jpg" ? "jpeg" : match[1];
      const image = Buffer.from(match[2], "base64");
      if (!image.length || image.length > 8 * 1024 * 1024) return res.status(413).json({ error: "جلد رمان بیش از اندازه بزرگ است." });
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.type(`image/${mime}`).send(image);
    }
    const placeholder = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs><rect width="600" height="900" fill="url(#g)"/><path d="M175 260h250v330H175z" fill="none" stroke="#a5b4fc" stroke-width="18"/><path d="M215 315h170M215 375h170M215 435h115" stroke="#a5b4fc" stroke-width="14" stroke-linecap="round"/><text x="300" y="690" fill="#e0e7ff" font-family="sans-serif" font-size="34" text-anchor="middle">REPTOC</text></svg>`;
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.type("image/svg+xml").send(placeholder);
  } catch (error: any) {
    console.error("Novel cover retrieval failed", {
      novelId: req.params.id,
      message: error?.message || String(error),
      code: error?.code,
      detail: error?.detail,
    });
    return res.status(404).json({ error: "جلد رمان یافت نشد." });
  }
});

router.get("/novels/:id", async (req, res) => {
  try {
    await publishDueScheduledChapters();
    const user = await getActiveUser(req, false);
    const { id } = req.params;
    const detailCacheKey = novelCacheKey(id, user);
    const cachedNovel = await sharedCache.get<any>(detailCacheKey);
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
    res.setHeader("Vary", "Cookie");
    if (cachedNovel) return res.json(cachedNovel);

    const { data: novel, error: novelError } = await supabase
      .from('novels')
      .select('*')
      .eq('id', id)
      .single();

    if (novelError || !novel) {
      return res.status(404).json({ error: "رمان یافت نشد." });
    }

    if (!canUserViewNovel(novel, user)) {
      return res.status(403).json({ error: "دسترسی غیرمجاز." });
    }

    await enrichNovelWithAuthorInfo(novel);

    const [chaptersResult, reviewsResult, likesResult, bookmarksResult, chapterLikesResult] = await Promise.all([
      supabase
        .from('chapters')
        .select(await chapterSelectColumns("full"))
        .eq('novel_id', id)
        .order('order_index', { ascending: true }),
      supabase
        .from('reviews')
        .select('id, novel_id, user_id, username, rating, rating_overall, rating_style, rating_story, rating_grammar, rating_character, content, created_at')
        .eq('novel_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('novel_likes')
        .select('id', { count: 'exact', head: true })
        .eq('novel_id', id),
      supabase
        .from('bookmarks')
        .select('id', { count: 'exact', head: true })
        .eq('novel_id', id),
      db.query(
        `SELECT chapter_id, count(*)::int AS likes_count,
                COALESCE(bool_or(user_id=$2), false) AS liked_by_viewer
           FROM chapter_likes
          WHERE novel_id=$1
          GROUP BY chapter_id`,
        [id, String(user?.id || "")],
      ),
    ]);

    const canManage = canManageNovel(user, novel);
    const chapters = (chaptersResult.data || []).filter((chapter: any) => isChapterVisibleToUser(chapter, canManage));
    const publicChapters = (chaptersResult.data || []).filter((chapter: any) => isChapterVisibleToUser(chapter, false));
    const reviews = (await hydrateReviewIdentities(reviewsResult.data || [])).map(mapReviewToClient);
    // Prose chapters expose stable paragraph identities (for paragraph comments);
    // manga chapters expose their ordered page list instead.
    const novelContentKind = normalizeContentKind((novel as any).content_kind);
    const isMangaNovel = novelContentKind === "manga";
    const [authorMaps, premiumAuthorIds, paragraphsByChapter, pagesByChapter] = await Promise.all([
      buildNovelAuthorIdentityMaps([novel]),
      getActiveWriterPremiumUserIds([String(novel.author_id || "")]),
      isMangaNovel
        ? Promise.resolve(new Map<string, Array<{ id: string; ordinal: number }>>())
        : loadParagraphsForChapters(chapters).catch((error) => {
          console.error("Failed to load stable paragraph identities", {
            novelId: id,
            message: error instanceof Error ? error.message : String(error),
          });
          return new Map<string, Array<{ id: string; ordinal: number }>>();
        }),
      isMangaNovel
        ? loadPagesForChapters(chapters.map((chapter: any) => String(chapter.id))).catch((error) => {
          console.error("Failed to load manga pages", {
            novelId: id,
            message: error instanceof Error ? error.message : String(error),
          });
          return new Map<string, Awaited<ReturnType<typeof loadChapterPages>>>();
        })
        : Promise.resolve(new Map<string, Awaited<ReturnType<typeof loadChapterPages>>>()),
    ]);
    const authorIdentity = getNovelAuthorIdentity(novel, authorMaps);
    const savedPremiumPresentation = sanitizePremiumPresentation(novel.premium_presentation);
    const premiumPresentationActive = savedPremiumPresentation.enabled && premiumAuthorIds.has(String(novel.author_id || ""));

    const chapterLikesMap = new Map<string, { likesCount: number; likedByCurrentUser: boolean }>(
      (chapterLikesResult.rows || []).map((row: any) => [
        String(row.chapter_id),
        { likesCount: Number(row.likes_count || 0), likedByCurrentUser: row.liked_by_viewer === true },
      ]),
    );
    const likesCount = Number(likesResult.count || 0) + [...chapterLikesMap.values()].reduce((total, item) => total + item.likesCount, 0);
    const bookmarksCount = bookmarksResult.count || 0;
    if (Number(novel.likes_count || 0) !== likesCount) {
      await supabase.from('novels').update({ likes_count: likesCount }).eq('id', id);
    }

    const hydratedNovel = {
      id: novel.id,
      title: novel.title,
      author: novel.author || authorIdentity.username,
      author_id: novel.author_id,
      authorUsername: authorIdentity.username || novel.author,
      authorAvatar: authorIdentity.avatar || "",
      authorDisplayName: novel.author || authorIdentity.displayName,
      cover: novel.cover_url,
      coverUrl: novel.cover_url,
      description: novel.description,
      rating: ratingForReviewCount(novel.rating, reviews.length),
      status: novel.status,
      approvalStatus: novel.approval_status || 'pending_approval',
      genre: novel.genre,
      reviewsCount: reviews.length,
      wordsCount: novel.words_count || 0,
      viewsCount: Number(novel.views_count || 0),
      publishedChapterCount: publicChapters.filter((chapter: any) => chapter.is_auxiliary !== true).length,
      averageViews: calculateAverageViews(novel.views_count, publicChapters.filter((chapter: any) => chapter.is_auxiliary !== true).length),
      bookmarksCount,
      likesCount,
      isCompleted: novel.is_completed === 1 || novel.is_completed === true,
      tags: sanitizeTaxonomyList(Array.isArray(novel.tags) ? novel.tags : []),
      mainCategories: sanitizeTaxonomyList(Array.isArray(novel.main_categories) ? novel.main_categories : []),
      subCategories: sanitizeTaxonomyList(Array.isArray(novel.sub_categories) ? novel.sub_categories : []),
      warnings: sanitizeTaxonomyList(Array.isArray(novel.warnings) ? novel.warnings : []),
      ageRating: novel.age_rating || "PG-13",
      characters: Array.isArray(novel.characters) ? novel.characters : [],
      isAIGenerated: novel.is_ai_generated === true,
      isAIAssisted: novel.is_ai_assisted === true,
      contentKind: novelContentKind,
      readingDirection: normalizeReadingDirection((novel as any).reading_direction),
      premiumPresentation: premiumPresentationActive || canManage
        ? savedPremiumPresentation
        : { ...savedPremiumPresentation, enabled: false },
      premiumPresentationActive,
      preventCopy: novel.prevent_copy === true,
      preventScreenshot: novel.prevent_screenshot === true,
      createdAt: novel.created_at,
      updatedAt: novel.updated_at,
      editorNote: novel.editor_note || '',
      chapters: chapters.map((chapter: any) => ({
        id: chapter.id,
        novelId: chapter.novel_id,
        title: chapter.title,
        content: chapter.content || "",
        chapterNumber: chapter.chapter_number || ((chapter.order_index || 0) + 1),
        isAuxiliary: chapter.is_auxiliary === true,
        createdAt: chapter.created_at,
        updatedAt: chapter.updated_at || chapter.published_at || chapter.created_at,
        wordCount: chapter.word_count || 0,
        authorNotesTop: chapter.author_notes_top || "",
        authorNotesBottom: chapter.author_notes_bottom || "",
        status: chapter.status || "Published",
        editorialStatus: chapter.editorial_status || "draft",
        moderationStatus: chapter.moderation_status || "visible",
        assignedEditorId: chapter.assigned_editor_id || null,
        reviewDueAt: chapter.review_due_at || null,
        scheduledAt: chapter.scheduled_at || undefined,
        publishedAt: chapter.published_at || undefined,
        viewsCount: chapter.views_count || 0,
        preventCopy: chapter.prevent_copy === true,
        preventScreenshot: chapter.prevent_screenshot === true,
        likesCount: chapterLikesMap.get(chapter.id)?.likesCount || 0,
        likedByCurrentUser: chapterLikesMap.get(chapter.id)?.likedByCurrentUser || false,
        editorNote: chapter.editor_note || "",
        paragraphs: paragraphsByChapter.get(chapter.id) || [],
        ...(isMangaNovel
          ? {
            pages: pagesByChapter.get(chapter.id) || [],
            pageCount: (pagesByChapter.get(chapter.id) || []).length,
          }
          : {}),
      })),
      reviews
    };
    await sharedCache.set(detailCacheKey, hydratedNovel, 5 * 60);
    res.json(hydratedNovel);
  } catch (err) {
    console.error("Failed to fetch novel details:", err);
    res.status(400).json({ error: "دریافت جزئیات رمان انجام نشد." });
  }
});

router.get("/novels/:id/character-votes", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const { data: novel } = await supabase.from("novels").select("id, author_id, approval_status").eq("id", req.params.id).single();
    if (!novel) return res.status(404).json({ error: "رمان یافت نشد." });
    if (!canUserViewNovel(novel, user)) return res.status(403).json({ error: "دسترسی غیرمجاز." });
    res.json(await loadCharacterVoteSummary(req.params.id, user?.id));
  } catch (error) {
    console.error("Failed to load character votes:", error);
    res.status(500).json({ error: "بارگذاری رأی شخصیت‌ها انجام نشد." });
  }
});

router.post("/novels/:id/character-votes", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "برای رأی دادن به شخصیت وارد شوید." });
    const novelId = String(req.params.id || "");
    const characterId = sanitizePlainText(req.body?.characterId, 100).trim();
    if (!characterId) return res.status(400).json({ error: "شخصیت مورد نظر برای رأی را انتخاب کنید." });

    const outcome = await db.withTransaction(async (client) => {
      // Serialize a user's votes so simultaneous requests cannot exceed the daily cap.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`character-votes:${user.id}`]);
      const novelResult = await client.query(
        "SELECT id, author_id, approval_status, characters FROM novels WHERE id=$1 FOR SHARE",
        [novelId],
      );
      const novel = novelResult.rows[0];
      if (!novel) return { status: 404, error: "رمان یافت نشد." };
      if (!canUserViewNovel(novel, user)) return { status: 403, error: "دسترسی غیرمجاز." };
      const characters = sanitizeCharacters(novel.characters);
      if (!characters.some((character: any) => character.id === characterId)) {
        return { status: 404, error: "این شخصیت در این رمان یافت نشد." };
      }

      const existingVote = await client.query(
        "SELECT 1 FROM character_votes WHERE user_id=$1 AND novel_id=$2 AND character_id=$3",
        [user.id, novelId, characterId],
      );
      if (existingVote.rowCount) {
        return { status: 409, error: "قبلاً به این شخصیت رأی داده‌اید." };
      }
      const dailyVotes = await client.query(
        `SELECT count(*)::int AS votes_used
           FROM character_votes
          WHERE user_id=$1
            AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        [user.id],
      );
      if (Number(dailyVotes.rows[0]?.votes_used || 0) >= CHARACTER_VOTES_PER_DAY) {
        return { status: 429, error: "هر 3 رأی امروز خود را برای شخصیت‌ها استفاده کرده‌اید. پس از ساعت 00:00 UTC دوباره تلاش کنید." };
      }
      await client.query(
        "INSERT INTO character_votes (id, novel_id, character_id, user_id) VALUES ($1, $2, $3, $4)",
        [`character-vote-${uuidv4()}`, novelId, characterId, user.id],
      );
      return { status: 200 };
    });

    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    res.json(await loadCharacterVoteSummary(novelId, user.id));
  } catch (error: any) {
    if (error?.code === "23505") return res.status(409).json({ error: "قبلاً به این شخصیت رأی داده‌اید." });
    console.error("Failed to record character vote:", error);
    res.status(500).json({ error: "ثبت رأی شما ممکن نشد." });
  }
});

router.post("/novels", async (req, res) => {
  const publishRequestId = `pub-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const publishError = (status: number, error: string, code: string, source: string, field?: string) => res.status(status).json({
    error,
    code,
    source,
    field,
    requestId: publishRequestId
  });
  try {
    const user = await getActiveUser(req, true);
    if (!user) return publishError(401, "نشست شما یافت نشد یا منقضی شده است. پیش از انتشار دوباره وارد شوید.", "NOVEL_AUTH_REQUIRED", "authentication");
    if (user.publishing_blocked === true || user.publishing_blocked === 1) {
      return publishError(403, "انتشار برای این حساب توسط مدیر مسدود شده است.", "NOVEL_PUBLISHING_BLOCKED", "authorization");
    }
    const requestedChapterStatuses = Array.isArray(req.body?.chapters)
      ? req.body.chapters.map((chapter: any) => String(chapter?.status || chapter?.editorialStatus || "Draft").trim().toLowerCase())
      : [String(req.body?.chapterStatus || req.body?.chapterEditorialStatus || "Draft").trim().toLowerCase()];
    const requestsNonDraftChapter = requestedChapterStatuses.some((chapterStatus: string) => chapterStatus && chapterStatus !== "draft");
    if (requestsNonDraftChapter) {
      const emailGateError = await requireVerifiedEmailForWriting(user);
      if (emailGateError) return publishError(403, emailGateError, "NOVEL_EMAIL_NOT_VERIFIED", "authentication", "email");
    }
    await ensureOperationalTables().catch(() => {});

    const { id, title, author, coverUrl, cover, description, rating, status, genre, chapters, characters, isAIGenerated, isAIAssisted, mainCategories, subCategories, warnings, tags, ageRating, premiumPresentation, originType, originalAuthor, translators, contentKind, readingDirection, preventCopy, preventScreenshot } = req.body;
    if (!id) return publishError(400, "شناسه رمان تولید نشد.", "NOVEL_FIELD_MISSING", "validation", "id");
    if (!title) return publishError(400, "عنوان رمان الزامی است.", "NOVEL_FIELD_MISSING", "validation", "title");
    if (!author) return publishError(400, "نام نویسنده الزامی است.", "NOVEL_FIELD_MISSING", "validation", "author");

    // Origin metadata: an original work vs a translated one. Translated works
    // must credit the original author and at least one translator.
    const normalizedOriginType = originType === "translated" ? "translated" : "original";
    const sanitizedOriginalAuthor = sanitizePlainText(originalAuthor, 80).trim();
    const sanitizedTranslators = Array.isArray(translators)
      ? translators.map((name: any) => sanitizePlainText(name, 80).trim()).filter(Boolean).slice(0, 10)
      : [];
    if (normalizedOriginType === "translated") {
      if (!sanitizedOriginalAuthor) {
        return publishError(400, "برای رمان ترجمه‌شده، نام نویسندهٔ اثر اصلی الزامی است.", "NOVEL_FIELD_MISSING", "validation", "originalAuthor");
      }
      if (!sanitizedTranslators.length) {
        return publishError(400, "برای رمان ترجمه‌شده، حداقل یک مترجم باید ثبت شود.", "NOVEL_FIELD_MISSING", "validation", "translators");
      }
    }
    let taxonomy: Awaited<ReturnType<typeof validateNovelTaxonomy>>;
    try {
      taxonomy = await validateNovelTaxonomy({ genre, mainCategories, subCategories, warnings, tags, ageRating });
    } catch (taxonomyError: any) {
      return res.status(422).json({
        error: taxonomyError?.message || "طبقه‌بندی رمان نامعتبر است.",
        code: "NOVEL_TAXONOMY_INVALID",
        source: "taxonomy",
        field: /genre/i.test(taxonomyError?.message || "") ? "genre" : /main categor/i.test(taxonomyError?.message || "") ? "mainCategories" : /sub categor/i.test(taxonomyError?.message || "") ? "subCategories" : /warning/i.test(taxonomyError?.message || "") ? "warnings" : /age rating/i.test(taxonomyError?.message || "") ? "ageRating" : "taxonomy",
        invalidValue: taxonomyError?.invalidValue,
        requestId: publishRequestId
      });
    }

    const existingResult = await supabase.from('novels').select('id, author, author_id, approved_by, approval_status, genre, main_categories, sub_categories, warnings, tags, age_rating, premium_presentation, content_kind').eq('id', id).single();
    if (existingResult.error && existingResult.error.code !== "PGRST116") throw existingResult.error;
    const existing = existingResult.data;
    const normalizedRole = String(user.role || "").toLowerCase().trim();
    const isEditorialStaff = ['owner', 'publisher', 'editor'].includes(normalizedRole);
    if (existing && String(existing.author_id || "") !== String(user.id || "")) {
       return publishError(403, "فقط می‌توانید رمان‌های متعلق به حساب خود را ویرایش کنید.", "NOVEL_NOT_OWNER", "authorization", "author_id");
    }

    // The account is the owner via author_id; author is the public pen name.
    const effectiveAuthor = sanitizePlainText(author, 80).trim() || existing?.author || user.username;
    const sanitizedPremiumPresentation = premiumPresentation === undefined
      ? (existing?.premium_presentation || sanitizePremiumPresentation(undefined))
      : sanitizePremiumPresentation(premiumPresentation);
    if (sanitizedPremiumPresentation?.enabled && !(await hasWriterPremium(user.id))) {
      return publishError(403, "برای فعال‌سازی نمایش پریمیوم، اشتراک فعال نویسنده (Writer Premium) لازم است.", "WRITER_PREMIUM_REQUIRED", "authorization", "premiumPresentation");
    }

    // A work is prose or manga, and the kind is decided once at creation: the
    // two have incompatible chapter bodies (HTML vs image pages), so flipping it
    // later would orphan everything already written.
    const resolvedContentKind = existing
      ? normalizeContentKind((existing as any).content_kind)
      : normalizeContentKind(contentKind);
    const resolvedReadingDirection = normalizeReadingDirection(
      readingDirection ?? (resolvedContentKind === "manga" ? "rtl" : "rtl"),
    );
    if (existing && contentKind !== undefined && normalizeContentKind(contentKind) !== resolvedContentKind) {
      return publishError(
        409,
        resolvedContentKind === "manga"
          ? "این اثر به‌عنوان مانگا ساخته شده و نوع آن قابل تغییر نیست."
          : "این اثر به‌عنوان رمان ساخته شده و نوع آن قابل تغییر نیست.",
        "NOVEL_KIND_IMMUTABLE",
        "validation",
        "contentKind",
      );
    }

    const novelPayload = await filterPayloadToExistingColumns("novels", {
      id,
      title: String(title).slice(0, 160),
      author: effectiveAuthor,
      author_id: existing ? existing.author_id : user.id,
      cover_url: normalizeStoredImageReference(coverUrl !== undefined ? coverUrl : (cover || ""), { allowLegacyDataUrl: true }),
      description: sanitizePlainText(description, 5000),
      // A story has no rating until a reader submits the first rating.
      // Existing ratings are never overwritten by metadata/chapter saves.
      rating: existing ? undefined : 0,
      status: status || "Ongoing",
      approval_status: existing ? existing.approval_status : 'pending_approval',
      genre: taxonomy.genre,
      tags: taxonomy.tags,
      warnings: taxonomy.warnings,
      main_categories: taxonomy.mainCategories,
      sub_categories: taxonomy.subCategories,
      age_rating: taxonomy.ageRating,
      is_ai_generated: !!isAIGenerated,
      is_ai_assisted: !!isAIAssisted,
      origin_type: normalizedOriginType,
      original_author: normalizedOriginType === "translated" ? sanitizedOriginalAuthor : "",
      translators: normalizedOriginType === "translated" ? sanitizedTranslators : [],
      content_kind: resolvedContentKind,
      reading_direction: resolvedReadingDirection,
      characters: sanitizeCharacters(characters),
      premium_presentation: sanitizedPremiumPresentation,
      prevent_copy: preventCopy === true,
      prevent_screenshot: preventScreenshot === true,
      updated_at: new Date().toISOString()
    });
    const novelWriteResult = await supabase.from('novels').upsert(novelPayload);
    if (novelWriteResult.error) throw novelWriteResult.error;

    if (chapters && Array.isArray(chapters)) {
      for (let i = 0; i < chapters.length; i++) {
        const chap = chapters[i];
        const chapterNumber = Number(chap.chapterNumber || i + 1);
        const isAuxiliary = chap.isAuxiliary === true || chap.is_auxiliary === true;
        const { chapterId, existingChapter } = await resolveChapterIdentity(id, chap.id, chapterNumber, isAuxiliary);
        if (existingChapter) await saveChapterVersion(existingChapter, user.id, "metadata-save");

        const workflow = normalizeChapterSubmissionStatus(chap.status || chap.editorialStatus, isEditorialStaff);
        if (workflow.status === "Scheduled") {
          const scheduleTime = new Date(chap.scheduledAt || "").getTime();
          if (!Number.isFinite(scheduleTime) || scheduleTime <= Date.now()) {
            return publishError(400, `فصل ${chapterNumber}: برای انتشار زمان‌بندی‌شده، تاریخ و زمان معتبر در آینده انتخاب کنید.`, "CHAPTER_SCHEDULE_INVALID", "validation", `chapters[${i}].scheduledAt`);
          }
        }
        // Manga chapters carry image pages, not prose. Their body stays empty and
        // the ordered page list is written after the chapter row exists (the page
        // rows reference it).
        const isMangaChapter = resolvedContentKind === "manga";
        const requestedPages = Array.isArray(chap.pages) ? chap.pages : [];
        if (isMangaChapter && workflow.status !== "Draft" && requestedPages.length === 0) {
          return publishError(
            400,
            `فصل ${chapterNumber}: برای انتشار یک فصل مانگا حداقل یک صفحه لازم است.`,
            "MANGA_CHAPTER_EMPTY",
            "validation",
            `chapters[${i}].pages`,
          );
        }
        const sanitizedContent = isMangaChapter ? "" : sanitizeStoryHtml(chap.content);
        const now = new Date().toISOString();
        const wasPublic = existingChapter && isChapterVisibleToUser(existingChapter, false);
        const chapterPayload = {
          id: chapterId,
          novel_id: id,
          title: sanitizePlainText(chap.title || `فصل ${chapterNumber}`, 240),
          content: sanitizedContent,
          author_notes_top: sanitizePlainText(chap.authorNotesTop, 5000),
          author_notes_bottom: sanitizePlainText(chap.authorNotesBottom, 5000),
          status: workflow.status,
          editorial_status: workflow.editorial_status,
          scheduled_at: workflow.status === "Scheduled" ? chap.scheduledAt || null : null,
          submitted_at: (workflow as any).submitted_at || existingChapter?.submitted_at || null,
          approved_at: (workflow as any).approved_at || existingChapter?.approved_at || null,
          approved_by: (workflow as any).approved_at ? user.id : existingChapter?.approved_by || null,
          published_at: (workflow as any).published_at || existingChapter?.published_at || null,
          chapter_number: chapterNumber,
          is_auxiliary: isAuxiliary,
          word_count: isMangaChapter ? 0 : (chap.wordCount || countWordsFromHtml(sanitizedContent)),
          prevent_copy: chap.preventCopy === true || chap.prevent_copy === true,
          prevent_screenshot: chap.preventScreenshot === true || chap.prevent_screenshot === true,
          order_index: i,
          updated_at: now
        };
        const chapterWriteResult = await supabase.from('chapters').upsert(await filterPayloadToExistingColumns("chapters", chapterPayload));
        if (chapterWriteResult.error) throw chapterWriteResult.error;
        if (isMangaChapter) {
          try {
            await replaceChapterPages(id, chapterId, requestedPages, { ownerId: String(existing ? existing.author_id : user.id) });
          } catch (pageError: any) {
            if (pageError instanceof MangaPageError) {
              return publishError(pageError.status, `فصل ${chapterNumber}: ${pageError.message}`, pageError.code, "validation", `chapters[${i}].pages`);
            }
            throw pageError;
          }
        } else {
          await syncChapterParagraphs(chapterId, sanitizedContent);
        }
        if (!wasPublic && workflow.status === "Published") {
          sendDiscordChapterPublishedAnnouncement({
            id,
            title,
            author: effectiveAuthor,
            genre: taxonomy.genre,
            cover_url: normalizeStoredImageReference(coverUrl !== undefined ? coverUrl : (cover || ""), { allowLegacyDataUrl: true })
          }, chapterPayload).catch((e) => console.warn("[discord] Failed to announce chapter:", e?.message || e));
        }
      }
    }
    await syncSuggestionNovelArtifacts({
      id,
      authorId: existing ? existing.author_id : user.id,
      genre: taxonomy.genre,
      description,
      viewsCount: 0,
      bookmarksCount: 0,
      reviewsCount: 0,
      tags: taxonomy.tags,
      warnings: taxonomy.warnings,
      mainCategories: taxonomy.mainCategories,
      subCategories: taxonomy.subCategories,
      chapters: Array.isArray(chapters) ? chapters : []
    }).catch((e) => console.warn("Suggestion novel sync failed", e));

    // Recalculate and update stats of user: words_authored
    try {
      const { data: userNovels } = await supabase.from('novels').select('id').eq('author_id', user.id);
      if (userNovels && userNovels.length > 0) {
        const novelIds = userNovels.map(un => un.id);
        const { data: userChapters } = await supabase.from('chapters').select('word_count').in('novel_id', novelIds);
        const totalWords = (userChapters || []).reduce((sum, ch) => sum + (ch.word_count || 0), 0);
        
        // Award author achievements
        const totalPublishedChapters = (userChapters || []).length;
        if (totalPublishedChapters >= 1) await checkAndAwardAchievement(user.id, 'ach_author_first');
        if (totalPublishedChapters >= 100) await checkAndAwardAchievement(user.id, 'ach_author_100chapters');

        const { data: existingStats } = await supabase.from('settings').select('setting_value').eq('setting_key', userStatsKey(user.id)).single();
        let statsObj = { hours_read: 0, chapters_logged: 0, words_authored: 0, user_ranking: "#0" };
        if (existingStats?.setting_value) {
          try {
            statsObj = typeof existingStats.setting_value === 'string' ? JSON.parse(existingStats.setting_value) : existingStats.setting_value;
          } catch {}
        }
        
        statsObj.words_authored = totalWords;
        await supabase.from('settings').upsert({
          setting_key: userStatsKey(user.id),
          setting_value: JSON.stringify(statsObj),
          updated_at: new Date().toISOString()
        });
      }
    } catch (e) {
      console.error("Failed to autocalculate words authored: ", e);
    }

    await invalidateCache("novels", id);
    if (Array.isArray(chapters) && chapters.length > 0) {
      await recordDailyActivityStreak(user.id).catch((error) => {
        console.warn("Writing streak update failed:", error instanceof Error ? error.message : error);
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    const databaseCode = String(err?.code || err?.cause?.code || "");
    const isDatabaseError = /^\d{5}$/.test(databaseCode) || !!err?.constraint || !!err?.table;
    const safeDetail = sanitizePlainText(err?.detail || err?.message || "خطای ناشناخته در انتشار", 500);
    const safeDatabaseMessage: Record<string, string> = {
      "23505": "این رمان یا فصل از قبل وجود دارد. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.",
      "23503": "یکی از موارد مرتبط لازم (حساب، رمان یا فصل) دیگر وجود ندارد. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.",
      "23502": "یکی از مقادیر لازم برای انتشار ارسال نشده است.",
      "22P02": "قالب یکی از مقادیر ارسالی نامعتبر است.",
      "22001": "طول یکی از مقادیر ارسالی بیش از حد مجاز است. عنوان، خلاصه، عنوان فصل یا برچسب‌ها را کوتاه‌تر کنید."
    };
    const response = {
      error: isDatabaseError
        ? (safeDatabaseMessage[databaseCode] || "ذخیره رمان ممکن نشد؛ ذخیره‌سازی موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.")
        : (safeDetail || "سرور نتوانست این رمان را پردازش کند."),
      code: isDatabaseError ? (databaseCode === "23505" ? "NOVEL_ALREADY_EXISTS" : databaseCode === "23503" ? "NOVEL_RELATED_RECORD_MISSING" : databaseCode === "23502" ? "NOVEL_REQUIRED_VALUE_MISSING" : databaseCode === "22P02" ? "NOVEL_INVALID_VALUE_FORMAT" : databaseCode === "22001" ? "NOVEL_VALUE_TOO_LONG" : "NOVEL_STORAGE_FAILED") : "NOVEL_PUBLISH_ERROR",
      source: isDatabaseError ? "storage" : "server",
      field: err?.column || err?.constraint || undefined,
      detail: safeDetail,
      requestId: publishRequestId
    };
    console.error("Failed to write novel:", { ...response, databaseCode, detail: safeDetail, constraint: err?.constraint, table: err?.table, column: err?.column, stack: err?.stack });
    res.status(isDatabaseError ? 409 : 400).json(response);
  }
});

router.post("/novels/:id/chapters", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    if (user.publishing_blocked === true || user.publishing_blocked === 1) {
      return res.status(403).json({ error: "انتشار برای این حساب توسط مدیر مسدود شده است." });
    }
    const emailGateError = await requireVerifiedEmailForWriting(user);
    if (emailGateError) return res.status(403).json({ error: emailGateError });
    await ensureOperationalTables().catch(() => {});

    const { id } = req.params;
    const { data: novel } = await supabase
      .from("novels")
      .select("id, author, author_id, approved_by, approval_status, title, genre, cover_url, content_kind")
      .eq("id", id)
      .single();
    if (!novel) return res.status(404).json({ error: "رمان یافت نشد." });
    if (!canManageNovel(user, novel)) return res.status(403).json({ error: "فقط نویسنده یا تیم تحریریه می‌تواند فصل‌ها را مدیریت کند." });
    // Prose chapters store HTML; manga chapters store an ordered page list. The
    // kind of the work decides which body this save is allowed to carry.
    const isMangaChapter = normalizeContentKind((novel as any).content_kind) === "manga";

    const normalizedRole = String(user.role || "").toLowerCase().trim();
    const isEditorialStaff = ["owner", "publisher", "editor"].includes(normalizedRole);
    const workflow = normalizeChapterSubmissionStatus(req.body.status || req.body.editorialStatus, isEditorialStaff);
    if (
      ["Published", "Scheduled"].includes(workflow.status) &&
      String(novel.approval_status || "pending_approval").toLowerCase() !== "approved"
    ) {
      return res.status(409).json({ error: "پیش از انتشار فصل‌ها، رمان باید تأیید شود." });
    }
    const content = isMangaChapter ? "" : sanitizeStoryHtml(req.body.content);
    const requestedChapterNumber = Number(req.body.chapterNumber || req.body.chapter_number || 1);
    const isAuxiliary = req.body.isAuxiliary === true || req.body.is_auxiliary === true;
    const { chapterId, existingChapter } = await resolveChapterIdentity(id, req.body.id, requestedChapterNumber, isAuxiliary);
    if (existingChapter) await saveChapterVersion(existingChapter, user.id, req.body.reason || "chapter-save");
    // Images the chapter pointed at before this save. Any that the new body no
    // longer references become deletion candidates once the write lands.
    const previousImageReferences = extractStoredImageReferences(existingChapter?.content);

    const chapterNumber = Number(req.body.chapterNumber || req.body.chapter_number || existingChapter?.chapter_number || 1);
    const now = new Date().toISOString();
    const scheduledAt = workflow.status === "Scheduled" ? req.body.scheduledAt || req.body.scheduled_at || null : null;
    if (workflow.status === "Scheduled") {
      const scheduleTime = new Date(scheduledAt || "").getTime();
      if (!Number.isFinite(scheduleTime) || scheduleTime <= Date.now()) {
        return res.status(400).json({ error: "برای انتشار زمان‌بندی‌شده، تاریخ و زمان معتبر در آینده انتخاب کنید." });
      }
    }
    const wasPublic = existingChapter && isChapterVisibleToUser(existingChapter, false);

    const payload = {
      id: chapterId,
      novel_id: id,
      title: sanitizePlainText(req.body.title || `${isAuxiliary ? "فصل ویژه" : "فصل"} ${chapterNumber}`, 240),
      content,
      author_notes_top: sanitizePlainText(req.body.authorNotesTop || req.body.author_notes_top, 5000),
      author_notes_bottom: sanitizePlainText(req.body.authorNotesBottom || req.body.author_notes_bottom, 5000),
      status: workflow.status,
      editorial_status: workflow.editorial_status,
      scheduled_at: scheduledAt,
      submitted_at: (workflow as any).submitted_at || existingChapter?.submitted_at || null,
      approved_at: (workflow as any).approved_at || existingChapter?.approved_at || null,
      approved_by: (workflow as any).approved_at ? user.id : existingChapter?.approved_by || null,
      published_at: (workflow as any).published_at || existingChapter?.published_at || null,
      chapter_number: chapterNumber,
      is_auxiliary: isAuxiliary,
      word_count: isMangaChapter ? 0 : (Number(req.body.wordCount) || countWordsFromHtml(content)),
      prevent_copy: req.body.preventCopy !== undefined || req.body.prevent_copy !== undefined
        ? req.body.preventCopy === true || req.body.prevent_copy === true
        : existingChapter?.prevent_copy === true,
      prevent_screenshot: req.body.preventScreenshot !== undefined || req.body.prevent_screenshot !== undefined
        ? req.body.preventScreenshot === true || req.body.prevent_screenshot === true
        : existingChapter?.prevent_screenshot === true,
      order_index: Number(req.body.orderIndex ?? req.body.order_index ?? chapterNumber - 1),
      updated_at: now
    };

    // A manga chapter's body is its page list. `pages` is optional on save so the
    // editor can create the chapter shell first and upload scans afterwards, but a
    // chapter that goes public must have at least one page or readers would open a
    // blank viewer.
    const requestedPages = Array.isArray(req.body.pages) ? req.body.pages : null;
    if (isMangaChapter && ["Published", "Scheduled"].includes(workflow.status)) {
      const willHavePages = requestedPages
        ? requestedPages.length > 0
        : (await loadChapterPages(chapterId)).length > 0;
      if (!willHavePages) {
        return res.status(400).json({
          error: "برای انتشار یک فصل مانگا حداقل یک صفحه لازم است.",
          code: "MANGA_CHAPTER_EMPTY",
        });
      }
    }

    const filteredPayload = await filterPayloadToExistingColumns("chapters", payload);
    const writeResult = await supabase.from("chapters").upsert(filteredPayload);
    if (writeResult.error) {
      console.error("Chapter write failed:", writeResult.error);
      return res.status(400).json({ error: writeResult.error.message || "ذخیره فصل ممکن نشد." });
    }
    let mangaPages: Awaited<ReturnType<typeof loadChapterPages>> = [];
    let paragraphs: Awaited<ReturnType<typeof syncChapterParagraphs>> = [];
    if (isMangaChapter) {
      if (requestedPages) {
        try {
          const written = await replaceChapterPages(id, chapterId, requestedPages, {
            ownerId: String(novel.author_id || user.id),
          });
          mangaPages = written.pages;
        } catch (pageError: any) {
          if (pageError instanceof MangaPageError) {
            return res.status(pageError.status).json({ error: pageError.message, code: pageError.code });
          }
          throw pageError;
        }
      } else {
        mangaPages = await loadChapterPages(chapterId);
      }
    } else {
      paragraphs = await syncChapterParagraphs(chapterId, content);
    }
    await syncSuggestionNovelArtifactsFromDb(id).catch((e) => console.warn("Suggestion chapter sync failed", e));
    await publishDueScheduledChapters();

    const { data: savedChapter } = await supabase.from("chapters").select("*").eq("id", chapterId).single();
    if (!savedChapter) return res.status(500).json({ error: "تأیید ذخیره فصل ممکن نشد." });
    if (String(savedChapter.status || "").toLowerCase() !== workflow.status.toLowerCase()) {
      console.error("Chapter status verification failed:", { chapterId, requested: workflow.status, stored: savedChapter.status });
      return res.status(409).json({ error: `انتشار ناموفق بود: پایگاه داده این فصل را با وضعیت ${savedChapter.status || "unknown"} نگه داشت.` });
    }
    const isNowPublic = savedChapter && isChapterVisibleToUser(savedChapter, false);
    if (!wasPublic && isNowPublic) {
      const novelUpdateResult = await supabase.from("novels").update({ updated_at: now }).eq("id", id);
      if (novelUpdateResult.error) {
        console.warn("Failed to update novel release timestamp:", novelUpdateResult.error.message);
      }
    }
    if (!wasPublic && isNowPublic) {
      await notifyChapterPublishedAudience(novel, savedChapter);
      sendDiscordChapterPublishedAnnouncement(novel, savedChapter).catch((err) => {
        console.warn("[discord] Failed to announce chapter:", err?.message || err);
      });
    }

    await invalidateCache("novels", id);
    // Deleting a picture from a chapter must free the disk space too. This runs
    // after the write so the new body is what gets recounted, and it is
    // best-effort: a failed sweep must never fail the author's save.
    if (previousImageReferences.length) {
      const removedReferences = previousImageReferences.filter(
        (reference) => !extractStoredImageReferences(content).includes(reference),
      );
      if (removedReferences.length) {
        try {
          const candidateIds = await resolveStoredImageFileIds(removedReferences);
          const released = await releaseUnreferencedNovelFiles(id, String(novel.author_id || user.id), candidateIds);
          if (released.removed.length) {
            console.log("[media] reclaimed orphaned chapter images", {
              novelId: id,
              chapterId,
              files: released.removed.length,
              bytes: released.reclaimedBytes,
            });
          }
        } catch (error: any) {
          console.warn("[media] orphan sweep failed", { novelId: id, message: error?.message || error });
        }
      }
    }
    await recordDailyActivityStreak(user.id).catch((error) => {
      console.warn("Writing streak update failed:", error instanceof Error ? error.message : error);
    });
    res.json({ success: true, chapter: {
      id: savedChapter.id,
      novelId: savedChapter.novel_id,
      title: savedChapter.title,
      content: savedChapter.content || "",
      chapterNumber: savedChapter.chapter_number,
      isAuxiliary: savedChapter.is_auxiliary === true,
      createdAt: savedChapter.created_at,
      updatedAt: savedChapter.updated_at || savedChapter.published_at || savedChapter.created_at,
      wordCount: savedChapter.word_count,
      authorNotesTop: savedChapter.author_notes_top || "",
      authorNotesBottom: savedChapter.author_notes_bottom || "",
      status: savedChapter.status,
      editorialStatus: savedChapter.editorial_status || "draft",
      scheduledAt: savedChapter.scheduled_at || undefined,
      publishedAt: savedChapter.published_at || undefined,
      viewsCount: savedChapter.views_count || 0,
      preventCopy: savedChapter.prevent_copy === true,
      preventScreenshot: savedChapter.prevent_screenshot === true,
      paragraphs,
      pages: mangaPages,
      pageCount: isMangaChapter ? mangaPages.length : undefined
    }});
  } catch (err: any) {
    const msg = String(err?.message || "");
    // Persian messages are intentional author-facing copy; raw driver errors
    // stay server-side only.
    res.status(400).json({ error: msg && /[\u0600-\u06FF]/.test(msg) && msg.length < 300 ? msg : "ذخیره فصل انجام نشد." });
  }
});

router.get("/novels/:id/chapters/:chapterId/versions", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const { data: novel } = await supabase.from("novels").select("id, author_id, approved_by").eq("id", req.params.id).single();
    if (!novel || !canManageNovel(user, novel)) return res.status(403).json({ error: "دسترسی غیرمجاز." });

    const { data: versions } = await supabase
      .from("chapter_versions")
      .select("*")
      .eq("chapter_id", req.params.chapterId)
      .eq("novel_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(50);
    res.json({ versions: versions || [] });
  } catch {
    res.status(400).json({ error: "بارگذاری نسخه‌های فصل انجام نشد." });
  }
});

router.delete("/novels/:id/chapters/:chapterId/versions/:versionId", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const { data: novel } = await supabase.from("novels").select("id, author_id, approved_by").eq("id", req.params.id).single();
    if (!novel || !canManageNovel(user, novel)) return res.status(403).json({ error: "دسترسی غیرمجاز." });

    const { data: version } = await supabase
      .from("chapter_versions")
      .select("id")
      .eq("id", req.params.versionId)
      .eq("chapter_id", req.params.chapterId)
      .eq("novel_id", req.params.id)
      .single();
    if (!version) return res.status(404).json({ error: "نسخه یافت نشد." });

    await supabase
      .from("chapter_versions")
      .delete()
      .eq("id", req.params.versionId)
      .eq("chapter_id", req.params.chapterId)
      .eq("novel_id", req.params.id);

    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف نسخه فصل انجام نشد." });
  }
});

router.post("/novels/:id/chapters/:chapterId/restore", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const { data: novel } = await supabase.from("novels").select("id, author_id, approved_by").eq("id", req.params.id).single();
    if (!novel || !canManageNovel(user, novel)) return res.status(403).json({ error: "دسترسی غیرمجاز." });

    const { versionId } = req.body;
    const { data: version } = await supabase
      .from("chapter_versions")
      .select("*")
      .eq("id", versionId)
      .eq("chapter_id", req.params.chapterId)
      .eq("novel_id", req.params.id)
      .single();
    if (!version) return res.status(404).json({ error: "نسخه یافت نشد." });

    const { data: current } = await supabase.from("chapters").select("*").eq("id", req.params.chapterId).single();
    if (current) await saveChapterVersion(current, user.id, "restore-before-change");

    await supabase.from("chapters").update({
      title: version.title,
      content: version.content,
      author_notes_top: version.author_notes_top,
      author_notes_bottom: version.author_notes_bottom,
      status: version.status,
      scheduled_at: version.scheduled_at,
      chapter_number: version.chapter_number,
      word_count: version.word_count,
      updated_at: new Date().toISOString()
    }).eq("id", req.params.chapterId).eq("novel_id", req.params.id);
    await syncChapterParagraphs(req.params.chapterId, version.content);

    await invalidateCache("novels", req.params.id);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "بازیابی نسخه فصل انجام نشد." });
  }
});

router.delete("/novels/:id/chapters/:chapterId", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const { data: novel } = await supabase.from("novels").select("id, author_id, approved_by").eq("id", req.params.id).single();
    if (!novel || !canManageNovel(user, novel)) return res.status(403).json({ error: "دسترسی غیرمجاز." });

    const { data: chapter } = await supabase.from("chapters").select("*").eq("id", req.params.chapterId).eq("novel_id", req.params.id).single();
    if (!chapter) return res.status(404).json({ error: "فصل یافت نشد." });
    await saveChapterVersion(chapter, user.id, "chapter-delete");
    const deletedImageReferences = extractStoredImageReferences(chapter.content);
    await supabase.from("chapters").delete().eq("id", req.params.chapterId).eq("novel_id", req.params.id);
    await invalidateCache("novels", req.params.id);
    // Free the disk space the deleted chapter's illustrations occupied.
    if (deletedImageReferences.length) {
      try {
        const candidateIds = await resolveStoredImageFileIds(deletedImageReferences);
        await releaseUnreferencedNovelFiles(req.params.id, String(novel.author_id || user.id), candidateIds);
      } catch (error: any) {
        console.warn("[media] orphan sweep after chapter delete failed", { message: error?.message || error });
      }
    }
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف فصل انجام نشد." });
  }
});

async function chapterCommentContext(novelId: string, chapterId: string, user: any) {
  const { data: novel } = await supabase.from("novels").select("id, author_id, title, approval_status").eq("id", novelId).single();
  if (!novel || !canUserViewNovel(novel, user)) return null;
  const { data: chapter } = await supabase.from("chapters").select("*").eq("id", chapterId).eq("novel_id", novelId).single();
  if (!chapter || !isChapterVisibleToUser(chapter, canManageNovel(user, novel))) return null;
  return { novel, chapter };
}

async function hydrateChapterComments(comments: any[], currentUserId?: string | null) {
  const profiles = await loadPublicUsers("id", comments.map((comment: any) => String(comment.user_id || "")));
  const profilesById = new Map(profiles.map((profile: any) => [String(profile.id), profile]));
  const commentIds = comments.map((comment: any) => String(comment.id || "")).filter(Boolean);
  const likeRows = commentIds.length
    ? (await db.query(
      `SELECT comment_id,COUNT(*)::int AS likes_count,
              COALESCE(BOOL_OR(user_id=$2::text),false) AS liked_by_current_user
         FROM chapter_comment_likes
        WHERE comment_id=ANY($1::text[])
        GROUP BY comment_id`,
      [commentIds, currentUserId || null],
    )).rows
    : [];
  const likesByCommentId = new Map(likeRows.map((row: any) => [String(row.comment_id), row]));
  return comments.map((comment: any) => {
    const identity = buildPublicUserIdentity(profilesById.get(String(comment.user_id || "")) || {}, comment);
    const likeState: any = likesByCommentId.get(String(comment.id)) || {};
    return {
      ...comment,
      content: comment.deleted_at ? "این دیدگاه حذف شده است." : comment.content,
      userId: identity.userId,
      username: comment.deleted_at ? "" : identity.username,
      displayName: comment.deleted_at ? "دیدگاه حذف‌شده" : identity.displayName,
      avatar: comment.deleted_at ? "" : identity.avatar,
      role: identity.role,
      likesCount: Number(likeState.likes_count || 0),
      likedByCurrentUser: likeState.liked_by_current_user === true,
    };
  });
}

router.get("/novels/:id/chapters/:chapterId/comments", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const { id, chapterId } = req.params;
    if (!(await chapterCommentContext(id, chapterId, user))) return res.status(404).json({ error: "این فصل در دسترس نیست." });
    const commentsResult = await supabase
      .from("chapter_comments")
      .select("*")
      .eq("novel_id", id)
      .eq("chapter_id", chapterId)
      .is("paragraph_id", null)
      .eq("moderation_status", "visible")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: true });
    if (commentsResult.error) throw commentsResult.error;
    res.json({ comments: await hydrateChapterComments(commentsResult.data || [], user?.id) });
  } catch (error: any) {
    console.error("Chapter comments load failed", { novelId: req.params.id, chapterId: req.params.chapterId, message: error?.message, code: error?.code });
    res.status(400).json({ error: "بارگذاری دیدگاه‌های فصل انجام نشد." });
  }
});

router.post("/novels/:id/chapters/:chapterId/comments", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const { id, chapterId } = req.params;
    const content = sanitizePlainText(req.body.content, 5000).trim();
    if (!content) return res.status(400).json({ error: "متن دیدگاه الزامی است." });
    const context = await chapterCommentContext(id, chapterId, user);
    if (!context) return res.status(404).json({ error: "این فصل در دسترس نیست." });
    let parent: any = null;
    if (req.body.parentId) {
      parent = (await db.query(
        `SELECT id,user_id FROM chapter_comments
          WHERE id=$1 AND novel_id=$2 AND chapter_id=$3 AND paragraph_id IS NULL
            AND deleted_at IS NULL AND moderation_status='visible'`,
        [String(req.body.parentId), id, chapterId],
      )).rows[0];
      if (!parent) return res.status(422).json({ error: "هدف پاسخ بخشی از گفتگوی این فصل نیست." });
    }
    const commentId = `cc-${uuidv4()}`;
    const createdAt = new Date().toISOString();
    const moderation = await moderateNewComment(content);
    const insert = await supabase.from("chapter_comments").insert({
      id: commentId, novel_id: id, chapter_id: chapterId, user_id: user.id,
      parent_id: parent?.id || null, paragraph_id: null, paragraph_index: null, content, created_at: createdAt,
      moderation_status: moderation.status, moderation_source: moderation.source,
      moderation_result: moderation.result, moderated_at: moderation.status === "pending" ? null : createdAt,
    });
    if (insert.error) throw insert.error;
    const recipients = new Set<string>();
    if (moderation.status === "visible") {
      if (context.novel.author_id && context.novel.author_id !== user.id) recipients.add(context.novel.author_id);
      if (parent?.user_id && parent.user_id !== user.id) recipients.add(parent.user_id);
      await Promise.all([...recipients].map((recipient) => createUserNotification(
        recipient,
        parent?.user_id === recipient ? "comment_reply" : "chapter_comment",
        parent?.user_id === recipient ? "پاسخ جدید" : "دیدگاه جدید در فصل",
        `${user.username} روی ${context.chapter.title} دیدگاه گذاشت.`,
        `/novels/${id}/chapters/${chapterId}`,
        parent?.user_id === recipient ? "notify_replies" : "notify_comments",
      )));
    }
    // Mirror the author-facing comment into the inbox (Mail) with a deep link
    // so it is clickable from the صندوق ورودی panel as well.
    if (moderation.status === "visible" && recipients.has(context.novel.author_id)) {
      await mirrorToInbox(
        context.novel.author_id,
        user.username,
        `دیدگاه جدید روی «${context.chapter.title}»`,
        content.slice(0, 200),
        `/novels/${id}/chapters/${chapterId}`
      );
    }
    const identity = buildPublicUserIdentity(user, user);
    const publicComment = moderation.status === "visible" ? {
      id: commentId, novel_id: id, chapter_id: chapterId, user_id: user.id,
      userId: identity.userId, username: identity.username, displayName: identity.displayName,
      avatar: identity.avatar, role: identity.role, parent_id: parent?.id || null,
      paragraph_id: null, content, is_pinned: false, created_at: createdAt,
      likesCount: 0, likedByCurrentUser: false,
    } : null;
    res.status(201).json({ success: true, id: commentId, comment: publicComment, moderationStatus: moderation.status,
      message: moderation.status === "pending" ? "دیدگاه شما ثبت شد و پس از تأیید نمایش داده می‌شود." : moderation.status === "rejected" ? "دیدگاه توسط سامانهٔ نظارت پذیرفته نشد." : "دیدگاه منتشر شد." });
  } catch (error: any) {
    console.error("Chapter comment post failed", { novelId: req.params.id, chapterId: req.params.chapterId, message: error?.message, code: error?.code, detail: error?.detail });
    res.status(400).json({ error: "ارسال دیدگاه فصل انجام نشد." });
  }
});

router.get("/novels/:id/chapters/:chapterId/paragraph-comments/counts", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!(await chapterCommentContext(req.params.id, req.params.chapterId, user))) return res.status(404).json({ error: "این فصل در دسترس نیست." });
    const { rows } = await db.query(
      `SELECT paragraph_id,COUNT(*)::int AS count
         FROM chapter_comments
        WHERE novel_id=$1 AND chapter_id=$2 AND paragraph_id IS NOT NULL
          AND deleted_at IS NULL AND moderation_status='visible'
        GROUP BY paragraph_id`,
      [req.params.id, req.params.chapterId],
    );
    res.json({ counts: Object.fromEntries(rows.map((row: any) => [row.paragraph_id, row.count])) });
  } catch (error: any) {
    console.error("Paragraph comment counts failed", { chapterId: req.params.chapterId, message: error?.message, code: error?.code });
    res.status(400).json({ error: "بارگذاری تعداد دیدگاه‌های پاراگراف انجام نشد." });
  }
});

router.get("/novels/:id/chapters/:chapterId/paragraphs/:paragraphId/comments", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!(await chapterCommentContext(req.params.id, req.params.chapterId, user))) return res.status(404).json({ error: "این فصل در دسترس نیست." });
    const paragraph = (await db.query(
      "SELECT id FROM chapter_paragraphs WHERE id=$1 AND chapter_id=$2 AND deleted_at IS NULL",
      [req.params.paragraphId, req.params.chapterId],
    )).rows[0];
    if (!paragraph) return res.status(404).json({ error: "این پاراگراف در دسترس نیست." });
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
    let cursorDate: string | null = null;
    let cursorId: string | null = null;
    if (req.query.cursor) {
      try {
        [cursorDate, cursorId] = Buffer.from(String(req.query.cursor), "base64url").toString("utf8").split("|", 2);
        if (!cursorDate || !cursorId || !Number.isFinite(new Date(cursorDate).getTime())) throw new Error("bad cursor");
      } catch {
        return res.status(400).json({ error: "نشانه صفحه‌بندی دیدگاه‌ها نامعتبر است." });
      }
    }
    const { rows } = await db.query(
      `SELECT *
         FROM chapter_comments
        WHERE novel_id=$1 AND chapter_id=$2 AND paragraph_id=$3
          AND moderation_status='visible'
          AND ($4::timestamptz IS NULL OR (created_at,id)>($4::timestamptz,$5::text))
        ORDER BY created_at,id
        LIMIT $6`,
      [req.params.id, req.params.chapterId, req.params.paragraphId, cursorDate, cursorId, limit + 1],
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    res.json({
      comments: await hydrateChapterComments(page, user?.id),
      nextCursor: hasMore && last ? Buffer.from(`${new Date(last.created_at).toISOString()}|${last.id}`).toString("base64url") : null,
    });
  } catch (error: any) {
    console.error("Paragraph comments load failed", { chapterId: req.params.chapterId, paragraphId: req.params.paragraphId, message: error?.message, code: error?.code });
    res.status(400).json({ error: "بارگذاری دیدگاه‌های پاراگراف انجام نشد." });
  }
});

router.post("/novels/:id/chapters/:chapterId/paragraphs/:paragraphId/comments", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const context = await chapterCommentContext(req.params.id, req.params.chapterId, user);
    if (!context) return res.status(404).json({ error: "این فصل در دسترس نیست." });
    const content = sanitizePlainText(req.body.content, 5000).trim();
    if (!content) return res.status(422).json({ error: "متن دیدگاه الزامی است.", field: "content" });
    const paragraph = (await db.query(
      "SELECT id FROM chapter_paragraphs WHERE id=$1 AND chapter_id=$2 AND deleted_at IS NULL",
      [req.params.paragraphId, req.params.chapterId],
    )).rows[0];
    if (!paragraph) return res.status(422).json({ error: "این پاراگراف دیگر وجود ندارد.", field: "paragraphId" });
    let parent: any = null;
    if (req.body.parentId) {
      parent = (await db.query(
        `SELECT id,user_id FROM chapter_comments
          WHERE id=$1 AND chapter_id=$2 AND paragraph_id=$3
            AND deleted_at IS NULL AND moderation_status='visible'`,
        [String(req.body.parentId), req.params.chapterId, req.params.paragraphId],
      )).rows[0];
      if (!parent) return res.status(422).json({ error: "هدف پاسخ بخشی از این پاراگراف نیست." });
    }
    const id = `pc-${uuidv4()}`;
    const createdAt = new Date().toISOString();
    const moderation = await moderateNewComment(content);
    await db.query(
      `INSERT INTO chapter_comments(id,novel_id,chapter_id,user_id,parent_id,paragraph_id,paragraph_index,content,created_at,
                                    moderation_status,moderation_source,moderation_result,moderated_at)
       VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12)`,
      [id, req.params.id, req.params.chapterId, user.id, parent?.id || null, req.params.paragraphId, content, createdAt,
       moderation.status, moderation.source, moderation.result, moderation.status === "pending" ? null : createdAt],
    );
    const recipients = new Map<string, "reply" | "author">();
    if (moderation.status === "visible") {
      if (context.novel.author_id && context.novel.author_id !== user.id) recipients.set(context.novel.author_id, "author");
      if (parent?.user_id && parent.user_id !== user.id) recipients.set(parent.user_id, "reply");
      await Promise.all([...recipients].map(([recipient, kind]) => createUserNotification(
        recipient, kind === "reply" ? "comment_reply" : "paragraph_comment",
        kind === "reply" ? "پاسخ جدید در پاراگراف" : "دیدگاه جدید در پاراگراف",
        `${user.username} روی پاراگرافی از ${context.chapter.title} دیدگاه گذاشت.`,
        `/novels/${req.params.id}/chapters/${req.params.chapterId}?paragraph=${encodeURIComponent(req.params.paragraphId)}`,
        kind === "reply" ? "notify_replies" : "notify_comments",
      )));
    }
    if (moderation.status === "visible" && recipients.get(context.novel.author_id) === "author") {
      await mirrorToInbox(
        context.novel.author_id,
        user.username,
        `دیدگاه جدید روی «${context.chapter.title}»`,
        content.slice(0, 200),
        `/novels/${req.params.id}/chapters/${req.params.chapterId}?paragraph=${encodeURIComponent(req.params.paragraphId)}`
      );
    }
    const identity = buildPublicUserIdentity(user, user);
    const publicComment = moderation.status === "visible" ? {
      id, novel_id: req.params.id, chapter_id: req.params.chapterId, paragraph_id: req.params.paragraphId,
      user_id: user.id, userId: identity.userId, username: identity.username, displayName: identity.displayName,
      avatar: identity.avatar, role: identity.role, parent_id: parent?.id || null, content, created_at: createdAt,
      likesCount: 0, likedByCurrentUser: false,
    } : null;
    res.status(201).json({ success: true, comment: publicComment, moderationStatus: moderation.status,
      message: moderation.status === "pending" ? "دیدگاه شما ثبت شد و پس از تأیید نمایش داده می‌شود." : moderation.status === "rejected" ? "دیدگاه توسط سامانهٔ نظارت پذیرفته نشد." : "دیدگاه منتشر شد." });
  } catch (error: any) {
    console.error("Paragraph comment post failed", { chapterId: req.params.chapterId, paragraphId: req.params.paragraphId, message: error?.message, code: error?.code, detail: error?.detail });
    res.status(400).json({ error: "ارسال دیدگاه پاراگراف انجام نشد." });
  }
});

router.patch("/novels/:id/chapters/:chapterId/comments/:commentId", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    if (!(await chapterCommentContext(req.params.id, req.params.chapterId, user))) return res.status(404).json({ error: "این فصل در دسترس نیست." });
    const content = sanitizePlainText(req.body.content, 5000).trim();
    if (!content) return res.status(422).json({ error: "متن دیدگاه الزامی است." });
    const moderation = await moderateNewComment(content);
    const result = await db.query(
      `UPDATE chapter_comments
          SET content=$1,updated_at=timezone('utc'::text,now()),moderation_status=$2,
              moderation_source=$3,moderation_result=$4,moderated_at=$5,moderated_by=NULL
        WHERE id=$6 AND novel_id=$7 AND chapter_id=$8 AND user_id=$9 AND deleted_at IS NULL
        RETURNING updated_at`,
      [content, moderation.status, moderation.source, moderation.result, moderation.status === "pending" ? null : new Date().toISOString(),
       req.params.commentId, req.params.id, req.params.chapterId, user.id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "دیدگاه یافت نشد یا متعلق به این حساب نیست." });
    res.json({ success: true, content, updatedAt: result.rows[0].updated_at, moderationStatus: moderation.status,
      message: moderation.status === "pending" ? "ویرایش ثبت شد و پس از تأیید نمایش داده می‌شود." : moderation.status === "rejected" ? "ویرایش توسط سامانهٔ نظارت پذیرفته نشد." : "ویرایش منتشر شد." });
  } catch (error: any) {
    console.error("Chapter comment edit failed", { commentId: req.params.commentId, message: error?.message, code: error?.code });
    res.status(400).json({ error: "ویرایش دیدگاه انجام نشد." });
  }
});

router.delete("/novels/:id/chapters/:chapterId/comments/:commentId", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    if (!(await chapterCommentContext(req.params.id, req.params.chapterId, user))) return res.status(404).json({ error: "این فصل در دسترس نیست." });
    const result = await db.query(
      `UPDATE chapter_comments
          SET content='',deleted_at=timezone('utc'::text,now()),updated_at=timezone('utc'::text,now())
        WHERE id=$1 AND novel_id=$2 AND chapter_id=$3 AND user_id=$4 AND deleted_at IS NULL`,
      [req.params.commentId, req.params.id, req.params.chapterId, user.id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "دیدگاه یافت نشد یا متعلق به این حساب نیست." });
    res.json({ success: true });
  } catch (error: any) {
    console.error("Chapter comment delete failed", { commentId: req.params.commentId, message: error?.message, code: error?.code });
    res.status(400).json({ error: "حذف دیدگاه انجام نشد." });
  }
});

router.put("/novels/:id/chapters/:chapterId/comments/:commentId/like", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const { id, chapterId, commentId } = req.params;
    if (!(await chapterCommentContext(id, chapterId, user))) return res.status(404).json({ error: "این فصل در دسترس نیست." });
    if (typeof req.body?.liked !== "boolean") return res.status(422).json({ error: "وضعیت پسند ارسال نشده است." });

    const comment = (await db.query(
      `SELECT id,user_id,paragraph_id
         FROM chapter_comments
        WHERE id=$1 AND novel_id=$2 AND chapter_id=$3
          AND deleted_at IS NULL AND moderation_status='visible'`,
      [commentId, id, chapterId],
    )).rows[0];
    if (!comment) return res.status(404).json({ error: "دیدگاه یافت نشد." });

    let newlyLiked = false;
    if (req.body.liked) {
      const inserted = await db.query(
        `INSERT INTO chapter_comment_likes(id,comment_id,user_id)
         VALUES($1,$2,$3)
         ON CONFLICT(comment_id,user_id) DO NOTHING
         RETURNING id`,
        [`ccl-${uuidv4()}`, commentId, user.id],
      );
      newlyLiked = !!inserted.rowCount;
    } else {
      await db.query("DELETE FROM chapter_comment_likes WHERE comment_id=$1 AND user_id=$2", [commentId, user.id]);
    }

    const likesCount = Number((await db.query(
      "SELECT COUNT(*)::int AS count FROM chapter_comment_likes WHERE comment_id=$1",
      [commentId],
    )).rows[0]?.count || 0);

    if (newlyLiked && comment.user_id && String(comment.user_id) !== String(user.id)) {
      const paragraphQuery = comment.paragraph_id ? `?paragraph=${encodeURIComponent(comment.paragraph_id)}` : "";
      await createUserNotification(
        comment.user_id,
        "comment_like",
        "پسند جدید دیدگاه",
        `${user.username} دیدگاه شما را پسندید.`,
        `/novels/${id}/chapters/${chapterId}${paragraphQuery}`,
        "notify_likes",
      );
    }

    res.json({ success: true, liked: req.body.liked, likesCount });
  } catch (error: any) {
    console.error("Chapter comment like failed", { commentId: req.params.commentId, message: error?.message, code: error?.code });
    res.status(400).json({ error: "به‌روزرسانی پسند دیدگاه انجام نشد." });
  }
});

router.post("/reports", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    await ensureOperationalTables();
    const targetType = sanitizePlainText(req.body.targetType, 40).toLowerCase();
    const targetId = sanitizePlainText(req.body.targetId, 160);
    const reason = sanitizePlainText(req.body.reason, 240);
    const details = sanitizePlainText(req.body.details, 5000);
    const priorityInput = sanitizePlainText(req.body.priority || "normal", 20).toLowerCase();
    const priority = ["low", "normal", "high", "urgent"].includes(priorityInput) ? priorityInput : "normal";
    if (!targetType || !targetId || !reason) return res.status(400).json({ error: "هدف گزارش و دلیل آن الزامی است." });
    if (!["user", "message", "novel", "chapter"].includes(targetType)) {
      return res.status(400).json({ error: "این نوع محتوا قابل گزارش‌گیری نیست." });
    }

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { count: reportsToday } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_id", user.id)
      .gte("created_at", dayStart.toISOString());
    if (Number(reportsToday || 0) >= 3) {
      return res.status(429).json({ error: "حداکثر 3 گزارش در روز می‌توانید ارسال کنید." });
    }

    let target: any = null;
    let targetUserId: string | null = null;
    if (targetType === "user") {
      const byId = await supabase.from("users").select("id, username, nickname, role").eq("id", targetId).single();
      target = byId.data || await resolveUsername(targetId);
      targetUserId = target?.id || null;
    } else if (targetType === "novel") {
      const result = await supabase.from("novels").select("id, title, author, author_id, description, approval_status").eq("id", targetId).single();
      target = result.data;
      targetUserId = target?.author_id || null;
    } else if (targetType === "chapter") {
      const result = await supabase.from("chapters").select("id, novel_id, title, content, chapter_number, status").eq("id", targetId).single();
      target = result.data;
      if (target?.novel_id) {
        const novelResult = await supabase.from("novels").select("author_id").eq("id", target.novel_id).single();
        targetUserId = novelResult.data?.author_id || null;
      }
    } else {
      for (const table of ["chapter_comments", "forum_posts", "messages"]) {
        const result = await supabase.from(table).select("*").eq("id", targetId).single();
        if (result.data) {
          target = { ...result.data, source_table: table };
          targetUserId = result.data.user_id || null;
          if (!targetUserId && table === "messages") targetUserId = result.data.sender_id || null;
          break;
        }
      }
    }
    if (!target) return res.status(404).json({ error: "هدف گزارش‌شده دیگر وجود ندارد." });
    if (targetUserId === user.id) return res.status(400).json({ error: "نمی‌توانید خودتان یا محتوای خودتان را گزارش کنید." });

    const reportId = `rep-${uuidv4()}`;
    await supabase.from("reports").insert({
      id: reportId,
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      target_user_id: targetUserId,
      target_snapshot: target,
      reason,
      details,
      priority
    });
    await supabase.from("report_events").insert({
      id: `revt-${uuidv4()}`,
      report_id: reportId,
      actor_id: user.id,
      event_type: "created",
      note: reason
    });
    res.json({ success: true, reportId, remainingToday: Math.max(0, 2 - Number(reportsToday || 0)) });
  } catch (err: any) {
    console.error("Report submission failed:", err?.message || err);
    res.status(400).json({ error: "ارسال گزارش انجام نشد." });
  }
});

router.post("/premium/checkout", sensitiveLimiter, async (req, res): Promise<any> => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "لطفاً پیش از شروع پرداخت وارد شوید." });

    const months = normalizePremiumDuration(req.body.months);
    const premiumType = normalizePremiumPlanType(req.body.premiumType);
    const quote = quotePremium(premiumType, months);

    /**
     * Stripe Price for this plan and duration.
     *
     * Reader and Writer are priced differently now, so a per-plan variable is
     * preferred and the shared `STRIPE_PRICE_PREMIUM_*` is kept as a fallback for
     * deployments that have not split them yet.
     */
    const planSuffix = premiumType === "writer" ? "WRITER" : "READER";
    const price = process.env[`STRIPE_PRICE_PREMIUM_${planSuffix}_${months}M`]
      || process.env[`STRIPE_PRICE_PREMIUM_${months}M`];
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret || !price) {
      return res.status(400).json({
        error: `پرداخت پریمیوم هنوز پیکربندی نشده است. متغیرهای STRIPE_SECRET_KEY و STRIPE_PRICE_PREMIUM_${planSuffix}_${months}M را تنظیم کنید.`,
      });
    }

    /**
     * The advertised price must equal what Stripe will charge.
     *
     * The plan page quotes from `shared/premiumPricing`, while the money comes
     * from the Stripe Price object. If the two disagree — a Price that was never
     * updated after a pricing change — the customer would be billed an amount
     * they never saw, so the checkout is refused instead.
     */
    const priceLookup = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(price)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    }).then((response) => response.json()).catch(() => null);
    if (priceLookup && !priceLookup.error) {
      const verification = assertPricingMatchesStripeAmount(quote, priceLookup.unit_amount);
      if (verification.ok === false) {
        console.error("[premium] advertised price does not match the Stripe price", {
          premiumType,
          months,
          quotedCents: quote.totalCents,
          stripeCents: priceLookup.unit_amount,
          priceId: price,
        });
        return res.status(409).json({ error: verification.message, code: "PREMIUM_PRICE_MISMATCH" });
      }
    }

    const allowedCheckoutOrigins = (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    const configuredOrigin = process.env.PUBLIC_SITE_URL || process.env.APP_URL || "http://localhost:3000";
    const requestOrigin = String(req.headers.origin || "");
    const origin = allowedCheckoutOrigins.includes(requestOrigin) ? requestOrigin : configuredOrigin;
    const orderId = `po-${uuidv4()}`;
    await supabase.from("premium_orders").insert(await filterPayloadToExistingColumns("premium_orders", {
      id: orderId,
      user_id: user.id,
      provider: "stripe",
      plan_months: months,
      premium_type: premiumType,
      // The figure the customer was shown, so a later dispute can be settled
      // without reconstructing the pricing table as it was that day.
      quoted_amount_cents: quote.totalCents,
      status: "pending"
    }));

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", `${origin}/?premium=success&order=${orderId}&session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${origin}/?premium=cancelled&order=${orderId}`);
    params.set("line_items[0][price]", price);
    params.set("line_items[0][quantity]", "1");
    params.set("metadata[order_id]", orderId);
    params.set("metadata[user_id]", user.id);
    params.set("metadata[months]", String(months));
    params.set("metadata[premium_type]", premiumType);

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    const body: any = await stripeRes.json();
    if (!stripeRes.ok || !body.url) {
      await supabase.from("premium_orders").update({ status: "failed", provider_payload: JSON.stringify(body) }).eq("id", orderId);
      return res.status(400).json({ error: "سرویس‌دهنده پرداخت درخواست را رد کرد." });
    }

    await supabase.from("premium_orders").update({ provider_session_id: body.id, provider_payload: JSON.stringify(body) }).eq("id", orderId);
    res.json({ success: true, checkoutUrl: body.url, orderId });
  } catch (err) {
    res.status(400).json({ error: "شروع فرآیند پرداخت پریمیوم انجام نشد." });
  }
});

router.post("/premium/stripe-confirm", async (req, res): Promise<any> => {
  try {
    const activeUser = await getActiveUser(req, true);
    if (!activeUser) return res.status(401).json({ error: "لطفاً پیش از تأیید پرداخت وارد شوید." });

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return res.status(400).json({ error: "Stripe پیکربندی نشده است." });

    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "شناسه نشست پرداخت ارسال نشده است." });

    const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { "Authorization": `Bearer ${secret}` }
    });
    const session: any = await stripeRes.json();
    if (!stripeRes.ok || session.payment_status !== "paid") {
      return res.status(400).json({ error: "پرداخت این نشست تکمیل نشده است." });
    }

    const orderId = session.metadata?.order_id;
    const userId = session.metadata?.user_id;
    if (userId !== activeUser.id) return res.status(403).json({ error: "این نشست پرداخت متعلق به این کاربر نیست." });

    const months = Number(session.metadata?.months || 1);
    const { data: order } = await supabase.from("premium_orders").select("*").eq("id", orderId).eq("user_id", userId).single();
    if (!order) return res.status(404).json({ error: "سفارش پریمیوم یافت نشد." });
    if (order.status === "paid") return res.json({ success: true });

    const premiumType = session.metadata?.premium_type === "writer" ? "writer" : "reader";
    const paidExpiry = (await db.query(`SELECT MAX(expires_at) AS expires_at FROM user_premium_entitlements WHERE user_id=$1 AND premium_type=$2 AND source='paid_subscription' AND revoked_at IS NULL AND status NOT IN ('revoked','cancelled')`, [userId, premiumType])).rows[0]?.expires_at;
    const start = paidExpiry && new Date(paidExpiry) > new Date() ? new Date(paidExpiry) : new Date();
    start.setMonth(start.getMonth() + months);
    if (premiumType === "reader") await supabase.from("users").update({ is_premium: true, premium_plan: `${months}m-no-ads`, premium_until: start.toISOString() }).eq("id", userId);
    await applyPremiumAction(userId, null, {
      action: "grant", premiumType, entitlementId: `paid-${premiumType}-${orderId}`,
      source: "paid_subscription", startsAt: new Date().toISOString(), expiresAt: start.toISOString(),
      paymentSubscriptionId: String(session.subscription || session.id || orderId),
      autoRenew: !!session.subscription, reason: "Stripe payment confirmation"
    });
    await supabase.from("premium_orders").update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider_payload: JSON.stringify(session)
    }).eq("id", orderId);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "تأیید پرداخت پریمیوم انجام نشد." });
  }
});

router.get("/admin/users", enforceAdmin, async (req, res) => {
  try {
    await ensureUserAdminColumns().catch((error) => reportSchemaGapOnce("legacy admin user columns", error));
    const userColumns = await filterExistingColumns("users", [
      "id",
      "username",
      "email",
      "phone",
      "nickname",
      "role",
      "departments",
      "notify_comments",
      "notify_followers",
      "notify_likes",
      "notify_bookmarks",
      "is_premium",
      "premium_plan",
      "premium_until",
      "premium_lifetime",
      "level",
      "xp",
      "coins",
      "stars",
      "streak",
      "avatar",
      "created_at",
      "verified_author",
      "verified_role",
      "email_verified",
      "twofa_enabled",
      "is_staff",
      "blocked",
      "publishing_blocked",
      "profile_bio"
    ]);
    const orderColumn = userColumns.includes("created_at") ? "created_at" : userColumns.includes("username") ? "username" : "id";
    const { data: usersList } = await supabase
      .from('users')
      .select(userColumns.join(", ") || "id, username")
      .order(orderColumn, { ascending: false });

    const enrichedUsers = [];
    for (const account of usersList || []) {
      const [
        statsResult,
        bioResult,
        novelsResult,
        reviewsResult,
        bookmarksResult,
        followersResult,
        followingResult,
        ticketsResult
      ] = await Promise.all([
        supabase.from('settings').select('setting_value').eq('setting_key', userStatsKey(account.id)).single(),
        Promise.resolve({ data: null }),
        supabase.from('novels').select('id', { count: 'exact', head: true }).eq('author_id', account.id),
        supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('user_id', account.id),
        supabase.from('bookmarks').select('id', { count: 'exact', head: true }).eq('user_id', account.id),
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('target_type', 'user').eq('target_id', account.id),
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', account.id),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('user_id', account.id)
      ]);

      let stats = { hours_read: 0, chapters_logged: 0, words_authored: 0, user_ranking: "#0" };
      if (statsResult.data?.setting_value) {
        try {
          stats = typeof statsResult.data.setting_value === 'string' ? JSON.parse(statsResult.data.setting_value) : statsResult.data.setting_value;
        } catch {}
      }

      enrichedUsers.push({
        ...account,
        premium_entitlements: await getEffectiveEntitlements(account.id, true).catch(() => ({ reader: false, writer: false, sources: [] })),
        bio: account.profile_bio || bioResult.data?.setting_value || "",
        stats,
        counts: {
          novels: novelsResult.count || 0,
          reviews: reviewsResult.count || 0,
          bookmarks: bookmarksResult.count || 0,
          followers: followersResult.count || 0,
          following: followingResult.count || 0,
          tickets: ticketsResult.count || 0
        }
      });
    }

    res.json({ success: true, users: enrichedUsers });
  } catch (err) {
    res.status(400).json({ error: "بارگذاری کاربران انجام نشد." });
  }
});

router.put("/admin/users/:id", enforceAdmin, async (req, res) => {
  try {
    // ✅ SECURITY: Validate user ID format before any DB operation.
    const targetId = String(req.params.id || "");
    if (!/^(u-[a-f0-9-]{8,80}|admin-master-[a-f0-9-]{8,80}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(targetId)) {
      return res.status(400).json({ error: "شناسه کاربر نامعتبر است." });
    }

    const actor = await getActiveUser(req, true);
    const actorIsOwner = String(actor?.role || "").toLowerCase().trim() === "owner";
    await ensureUserAdminColumns().catch((error) => reportSchemaGapOnce("legacy admin user columns", error));
    const { role, level, xp, coins, stars, password, premiumDays, premiumLifetime, disablePremium, is_premium, premium_plan, nickname, email, phone, avatar, departments, verified_author, verified_role, email_verified, profile_bio, is_staff, blocked, publishing_blocked } = req.body;
    const updates: any = {};
    // Owner-transfer rules match the hardened admin route: only the current
    // owner may grant or revoke the owner role.
    const allowedRoles = new Set(actorIsOwner ? ["writer", "editor", "publisher", "owner"] : ["writer", "editor", "publisher"]);
    if (role !== undefined && String(role).toLowerCase().trim() === "owner" && !actorIsOwner) {
      return res.status(403).json({ error: "فقط مالک فعلی می‌تواند دسترسی مالکیت را اعطا یا سلب کند." });
    }
    const normalizedRole = String(role || "").toLowerCase().trim();
    if (role !== undefined && allowedRoles.has(normalizedRole)) updates.role = normalizedRole;
    // Contact identifiers gate password-reset access; treat as sensitive and
    // restrict to owner-level actors on this legacy path.
    if ((email !== undefined || phone !== undefined) && !actorIsOwner) {
      return res.status(403).json({ error: "تغییر ایمیل یا شماره تماس کاربران فقط توسط مالک امکان‌پذیر است." });
    }
    if (level !== undefined) updates.level = Math.max(1, Math.min(999, Number(level) || 1));
    if (xp !== undefined) updates.xp = Math.max(0, Number(xp) || 0);
    if (coins !== undefined) updates.coins = Math.max(0, Number(coins) || 0);
    if (stars !== undefined) updates.stars = Math.max(0, Number(stars) || 0);
    if (nickname !== undefined) updates.nickname = sanitizePlainText(nickname, 80) || null;
    if (email !== undefined) updates.email = sanitizePlainText(email, 254) || null;
    if (phone !== undefined) updates.phone = sanitizePlainText(phone, 40) || null;
    if (avatar !== undefined) updates.avatar = sanitizePlainText(avatar, 500) || null;
    if (Array.isArray(departments)) updates.departments = JSON.stringify(departments.map((d: any) => sanitizePlainText(d, 40)).filter(Boolean));
    if (verified_author !== undefined) updates.verified_author = !!verified_author;
    if (verified_role !== undefined) updates.verified_role = !!verified_role;
    if (email_verified !== undefined) updates.email_verified = !!email_verified;
    if (is_staff !== undefined) updates.is_staff = !!is_staff;
    if (blocked !== undefined) updates.blocked = !!blocked;
    if (publishing_blocked !== undefined) updates.publishing_blocked = !!publishing_blocked;
    if (is_premium !== undefined) updates.is_premium = !!is_premium;
    if (premium_plan !== undefined) updates.premium_plan = sanitizePlainText(premium_plan, 80) || null;
    if (profile_bio !== undefined) updates.profile_bio = sanitizePlainText(profile_bio, 1000);
    
    if (password && password.trim() !== '') {
        updates.password = await bcrypt.hash(password, 12);
    }
    
    if (premiumDays > 0) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + premiumDays);
        updates.premium_until = expiresAt.toISOString();
        updates.is_premium = true;
        updates.premium_lifetime = false;
    } else if (premiumDays < 0) {
        updates.premium_until = null;
        updates.is_premium = false;
        updates.premium_lifetime = false;
    }
    if (premiumLifetime === true) {
        updates.is_premium = true;
        updates.premium_lifetime = true;
        updates.premium_until = null;
    }
    if (disablePremium === true) {
        updates.is_premium = false;
        updates.premium_lifetime = false;
        updates.premium_until = null;
        updates.premium_plan = null;
    }
    const existingUpdates = await filterPayloadToExistingColumns("users", updates);
    Object.keys(updates).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(existingUpdates, key)) delete updates[key];
    });
    if (!Object.keys(updates).length) return res.status(400).json({ error: "هیچ تغییری ارسال نشده است." });

    const returnColumns = await filterExistingColumns("users", ["username", "profile_bio"]);
    const { data: updatedUser, error } = await supabase.from('users').update(updates).eq('id', req.params.id).select(returnColumns.join(", ") || "id").single();
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "به‌روزرسانی کاربر انجام نشد." });
  }
});

router.delete("/admin/users/:id", enforceAdmin, async (req, res) => {
  try {
    // ✅ SECURITY: Validate user ID format before any DB operation.
    const targetId = String(req.params.id || "");
    if (!/^(u-[a-f0-9-]{8,80}|admin-master-[a-f0-9-]{8,80}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(targetId)) {
      return res.status(400).json({ error: "شناسه کاربر نامعتبر است." });
    }

    const actor = await getActiveUser(req, true);
    const actorIsOwner = String(actor?.role || "").toLowerCase().trim() === "owner";
    if (actor && String(actor.id) === String(targetId)) {
      return res.status(400).json({ error: "حذف حساب خودتان از این مسیر مجاز نیست." });
    }
    const { data: target } = await supabase.from("users").select("role").eq("id", targetId).single();
    if (target && String(target.role || "").toLowerCase().trim() === "owner" && !actorIsOwner) {
      return res.status(403).json({ error: "فقط مالک می‌تواند حساب مالک را حذف کند." });
    }
    await supabase.from('users').delete().eq('id', targetId); // Cascade delete if fk
    await supabase.from('sessions').delete().eq('user_id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "حذف کاربر انجام نشد." });
  }
});

router.post("/editor/novels/:id/moderate", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    const normalizedRole = String(user?.role || "").toLowerCase().trim();
    if (!user || !['owner', 'publisher', 'editor'].includes(normalizedRole)) return res.status(403).json({ error: "دسترسی غیرمجاز: نقش ویرایشگر یا مدیر لازم است." });
    
    const { id } = req.params;
    const { status, note } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: "وضعیت نامعتبر است." });

    const { data: nvl } = await supabase.from('novels').select('id, author, title, author_id, approved_by').eq('id', id).single();
    if (!nvl) return res.status(404).json({ error: "رمان یافت نشد." });
    if (!canManageNovel(user, nvl)) return res.status(403).json({ error: "این رمان به شما واگذار نشده است." });

    await supabase.from('novels').update({ approval_status: status, editor_note: sanitizePlainText(note || '', 2000) }).eq('id', id);

    if (nvl.author_id) {
      await createUserNotification(
        nvl.author_id,
        status === "approved" ? "novel_approved" : "novel_rejected",
        status === "approved" ? "✅ رمان تأیید شد!" : "☒ رمان پیش‌نویس رد شد",
        status === "approved" ? `رمان شما با عنوان ${nvl.title} تأیید شد.` : `دلیل: ${note}`,
        `/novels/${encodeURIComponent(nvl.id)}`
      );
    }

    await invalidateCache("novels", id);
    res.json({ success: true });
  } catch(err) {
    res.status(400).json({ error: "بررسی رمان انجام نشد." });
  }
});

router.put("/novels/:id", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { id } = req.params;
    const { title, author, coverUrl, cover, description, status, genre, isCompleted, tags, warnings, mainCategories, subCategories, ageRating, characters, isAIGenerated, isAIAssisted, premiumPresentation, originType, originalAuthor, translators, contentKind, readingDirection, preventCopy, preventScreenshot } = req.body;

    const { data: existing } = await supabase.from('novels').select('id, author, author_id, approved_by, approval_status, genre, main_categories, sub_categories, warnings, tags, age_rating, premium_presentation, cover_url, content_kind').eq('id', id).single();
    if (!existing) return res.status(404).json({ error: "اطلاعات اصلی رمان انتخاب‌شده در دسترس نیست." });

    if (String(existing.author_id || "") !== String(user.id || "")) {
       return res.status(403).json({ error: "غیرمجاز: فقط می‌توانید رمان‌های خودتان را ویرایش کنید." });
    }

    // Approval applies only when the novel is first created. Editing an
    // approved novel must not silently unpublish it or send it back to review.
    const newApprovalStatus = existing.approval_status;
    const taxonomy = await validateNovelTaxonomy({
      genre: genre ?? existing.genre,
      mainCategories: mainCategories ?? existing.main_categories,
      subCategories: subCategories ?? existing.sub_categories,
      // Stored legacy warnings must not block an unrelated metadata edit.
      warnings: warnings === undefined ? [] : warnings,
      legacyWarnings: existing.warnings,
      tags: tags ?? existing.tags,
      ageRating: ageRating ?? existing.age_rating
    });

    const updates: any = { approval_status: newApprovalStatus };
    if (author !== undefined) {
      const penName = sanitizePlainText(author, 80).trim();
      if (!penName) return res.status(400).json({ error: "نام مستعار نویسنده الزامی است." });
      updates.author = penName;
    }
    if (title !== undefined) updates.title = String(title).slice(0, 160);
    if (coverUrl !== undefined || cover !== undefined) {
      const requestedCover = coverUrl !== undefined ? coverUrl : cover;
      const derivedLegacyCover = `/api/novels/${encodeURIComponent(id)}/cover`;
      // Catalogue responses expose legacy data URLs through this safe endpoint.
      // Never write that derived display URL back over the original image.
      if (String(requestedCover || "").trim() !== derivedLegacyCover) {
        updates.cover_url = normalizeStoredImageReference(requestedCover || "", { allowLegacyDataUrl: true });
      }
    }
    if (description !== undefined) updates.description = sanitizePlainText(description, 5000);
    if (status !== undefined) updates.status = status;
    if (genre !== undefined) updates.genre = taxonomy.genre;
    if (isCompleted !== undefined) updates.is_completed = isCompleted ? 1 : 0;
    if (Array.isArray(tags)) updates.tags = taxonomy.tags;
    if (Array.isArray(warnings)) updates.warnings = taxonomy.warnings;
    if (Array.isArray(mainCategories)) updates.main_categories = taxonomy.mainCategories;
    if (Array.isArray(subCategories)) updates.sub_categories = taxonomy.subCategories;
    if (ageRating !== undefined) updates.age_rating = taxonomy.ageRating;
    if (Array.isArray(characters)) updates.characters = sanitizeCharacters(characters);
    if (isAIGenerated !== undefined) updates.is_ai_generated = !!isAIGenerated;
    if (isAIAssisted !== undefined) updates.is_ai_assisted = !!isAIAssisted;
    // The work's kind is fixed at creation: prose chapters hold HTML and manga
    // chapters hold image pages, so switching would orphan everything written.
    // The page-turn direction is presentation only and stays editable.
    if (contentKind !== undefined && normalizeContentKind(contentKind) !== normalizeContentKind((existing as any).content_kind)) {
      return res.status(409).json({
        error: "نوع اثر (رمان یا مانگا) پس از ساخت قابل تغییر نیست.",
        code: "NOVEL_KIND_IMMUTABLE",
        field: "contentKind",
      });
    }
    if (readingDirection !== undefined) updates.reading_direction = normalizeReadingDirection(readingDirection);
    if (preventCopy !== undefined) updates.prevent_copy = preventCopy === true;
    if (preventScreenshot !== undefined) updates.prevent_screenshot = preventScreenshot === true;
    if (originType !== undefined) {
      const nextOriginType = originType === "translated" ? "translated" : "original";
      const nextOriginalAuthor = sanitizePlainText(originalAuthor ?? "", 80).trim();
      const nextTranslators = Array.isArray(translators)
        ? translators.map((name: any) => sanitizePlainText(name, 80).trim()).filter(Boolean).slice(0, 10)
        : [];
      if (nextOriginType === "translated") {
        if (!nextOriginalAuthor) return res.status(400).json({ error: "برای رمان ترجمه‌شده، نام نویسندهٔ اثر اصلی الزامی است." });
        if (!nextTranslators.length) return res.status(400).json({ error: "برای رمان ترجمه‌شده، حداقل یک مترجم باید ثبت شود." });
        updates.original_author = nextOriginalAuthor;
        updates.translators = nextTranslators;
      }
      updates.origin_type = nextOriginType;
    }
    if (premiumPresentation !== undefined) {
      const sanitizedPremium = sanitizePremiumPresentation(premiumPresentation);
      if (sanitizedPremium.enabled && !(await hasWriterPremium(user.id))) {
        return res.status(403).json({
          error: "برای فعال‌سازی نمایش پریمیوم، اشتراک فعال نویسنده (Writer Premium) لازم است.",
          code: "WRITER_PREMIUM_REQUIRED",
          field: "premiumPresentation",
        });
      }
      updates.premium_presentation = sanitizedPremium;
    }

    updates.updated_at = new Date().toISOString();
    // Older deployments did not have novels.updated_at. Keep metadata edits
    // working during rolling/schema-lagged deployments by only writing columns
    // that actually exist (the create flow already uses the same safeguard).
    const persistedUpdates = await filterPayloadToExistingColumns("novels", updates);
    const updateResult = await supabase.from('novels').update(persistedUpdates).eq('id', id);
    if (updateResult.error) throw updateResult.error;
    const { data: savedNovel, error: verificationError } = await supabase.from('novels').select('*').eq('id', id).single();
    if (verificationError?.code === "PGRST116" || !savedNovel) {
      return res.status(404).json({ error: "رمان مورد نظر یافت نشد؛ ممکن است همزمان حذف شده باشد.", code: "NOVEL_NOT_FOUND" });
    }
    if (verificationError) throw verificationError;
    await syncSuggestionNovelArtifactsFromDb(id).catch((e) => console.warn("Suggestion novel metadata sync failed", e));

    await invalidateCache("novels", id);
    res.json({ success: true, approvalStatus: newApprovalStatus, novel: savedNovel });
  } catch (err: any) {
    const isTaxonomyError = /genre|categor|warning|age rating|at most|unsupported value/i.test(String(err?.message || ""));
    if (!isTaxonomyError) {
      console.error("Failed to update novel details:", {
        novelId: req.params.id,
        message: err?.message || String(err),
        code: err?.code || err?.cause?.code,
        detail: err?.detail || err?.cause?.detail,
        field: err?.field,
        invalidValue: err?.invalidValue
      });
    }
    res.status(isTaxonomyError ? 422 : 400).json({
      error: isTaxonomyError ? err.message : "به‌روزرسانی جزئیات رمان انجام نشد.",
      code: isTaxonomyError ? (err?.code || "NOVEL_TAXONOMY_INVALID") : "NOVEL_UPDATE_FAILED",
      field: err?.field,
      invalidValue: err?.invalidValue
    });
  }
});

router.delete("/novels/:id", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { id } = req.params;
    
    const { data: existing } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', id).single();
    if (!existing) return res.status(404).json({ error: "رمان یافت نشد." });

    if (!canManageNovel(user, existing)) {
      return res.status(403).json({ error: "غیرمجاز: فقط نویسنده یا مدیر می‌تواند این رمان را حذف کند." });
    }

    await deleteNovelCompletely(id);

    await invalidateCache("novels", id);
    res.json({ success: true, id });
  } catch (err) {
    res.status(400).json({ error: "حذف رمان انجام نشد." });
  }
});

router.post("/novels/bulk", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    const normalizedRole = String(user?.role || "").toLowerCase().trim();
    if (!user || (normalizedRole !== 'owner' && normalizedRole !== 'publisher')) {
       return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }

    const { novels } = req.body;
    if (!novels || !Array.isArray(novels)) return res.status(400).json({ error: "داده ارسالی نامعتبر است" });

    // Strict whitelist: reader-derived metrics (rating, review/view counters)
    // and ownership are never accepted from the payload. Text is sanitized
    // with the same rules as the single-novel path.
    const allowedStatuses = new Set(["pending_approval", "approved", "rejected"]);
    const allowedNovelStatuses = new Set(["Ongoing", "Completed", "Hiatus"]);
    for (const novel of novels) {
        if (!novel || typeof novel.id !== "string" || !novel.id.trim() || novel.id.length > 120) {
          return res.status(400).json({ error: "شناسه رمان نامعتبر است." });
        }
        const approvalStatus = String(novel.approvalStatus || "pending_approval");
        if (!allowedStatuses.has(approvalStatus)) {
          return res.status(400).json({ error: "وضعیت تأیید نامعتبر است." });
        }
        const status = String(novel.status || "Ongoing");
        const payload: Record<string, unknown> = {
            id: novel.id.trim(),
            title: sanitizePlainText(novel.title, 200),
            description: sanitizePlainText(novel.description, 5000),
            cover_url: sanitizePlainText(novel.coverUrl || novel.cover || "", 600) || null,
            status: allowedNovelStatuses.has(status) ? status : "Ongoing",
            genre: sanitizePlainText(novel.genre, 80) || "نامشخص",
            author: sanitizePlainText(novel.author, 80) || "نویسنده",
            author_id: user.id,
            approval_status: approvalStatus
        };
        await supabase.from('novels').upsert(payload, { onConflict: 'id' });
    }

    await invalidateCache("novels");
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ذخیره گروهی رمان‌ها انجام نشد." });
  }
});

router.get("/novels/:id/like", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const { id } = req.params;
    const { totalLikes } = await syncNovelLikeTotals(id);
    let liked = false;
    if (user) {
      const { data: existing } = await supabase.from('novel_likes').select('id').eq('novel_id', id).eq('user_id', user.id).single();
      liked = !!existing;
    }
    res.json({ success: true, liked, likesCount: totalLikes });
  } catch (err) {
    res.status(400).json({ error: "بارگذاری وضعیت پسند انجام نشد." });
  }
});

router.post("/novels/:id/like", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const { id } = req.params;
    const liked = !!req.body.liked;

    if (liked) {
      const analyticsContext = await buildAnalyticsContext(req);
      await supabase.from('novel_likes').upsert({ id: `nl-${id}-${user.id}`, novel_id: id, user_id: user.id });
      await supabase.from('analytics_logs').insert({
        id: `log-like-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        novel_id: id,
        viewer_id: user.id,
        action_type: "like",
        ...analyticsContext
      });
    } else {
      await supabase.from('novel_likes').delete().eq('novel_id', id).eq('user_id', user.id);
    }

    const { totalLikes } = await syncNovelLikeTotals(id);
    await recordSuggestionStatsEvent(id, liked ? "favorite" : "unfollow").catch(() => {});
    if (liked) {
      const { data: novel } = await supabase.from('novels').select('author_id, title').eq('id', id).single();
      if (novel?.author_id && novel.author_id !== user.id) {
        await createUserNotification(
          novel.author_id,
          "novel_like",
          "رمان پسندیده شد",
          `${user.username} رمان ${novel.title} را پسندید.`,
          `/novels/${id}`,
          "notify_likes"
        );
      }
    }
    await invalidateCache("novels", id);
    res.json({ success: true, liked, likesCount: totalLikes });
  } catch (err) {
    res.status(400).json({ error: "به‌روزرسانی وضعیت پسند انجام نشد." });
  }
});

router.get("/novels/:novelId/chapters/:chapterId/like", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    const { novelId, chapterId } = req.params;
    const chapter = (await db.query("SELECT id FROM chapters WHERE id=$1 AND novel_id=$2", [chapterId, novelId])).rows[0];
    if (!chapter) return res.status(404).json({ error: "فصل یافت نشد." });
    const likesCount = Number((await db.query("SELECT count(*)::int AS count FROM chapter_likes WHERE chapter_id=$1", [chapterId])).rows[0]?.count || 0);
    const { totalLikes: novelLikesCount } = await syncNovelLikeTotals(novelId);
    let liked = false;
    if (user) {
      liked = !!(await db.query("SELECT 1 FROM chapter_likes WHERE chapter_id=$1 AND user_id=$2", [chapterId, user.id])).rows[0];
    }
    res.json({ success: true, liked, likesCount, novelLikesCount, unlimited: true, usedToday: 0, dailyLimit: null });
  } catch (err) {
    res.status(400).json({ error: "بارگذاری وضعیت پسند فصل انجام نشد." });
  }
});

router.post("/novels/:novelId/chapters/:chapterId/like", interactionLimiter, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "برای پسندیدن فصل‌ها وارد شوید." });
    const { novelId, chapterId } = req.params;
    const wantsLike = !!req.body.liked;

    await client.query("BEGIN");
    // Serialize only this user's state for this chapter. Different chapters
    // remain independent while duplicate/concurrent requests stay idempotent.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`chapter-likes:${user.id}:${chapterId}`]);
    const chapter = (await client.query("SELECT id FROM chapters WHERE id=$1 AND novel_id=$2", [chapterId, novelId])).rows[0];
    if (!chapter) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "فصل یافت نشد." });
    }

    const existing = (await client.query("SELECT id FROM chapter_likes WHERE chapter_id=$1 AND user_id=$2", [chapterId, user.id])).rows[0];
    if (wantsLike && !existing) {
      await client.query("INSERT INTO chapter_likes(id,chapter_id,novel_id,user_id) VALUES($1,$2,$3,$4) ON CONFLICT(chapter_id,user_id) DO NOTHING", [`cl-${uuidv4()}`, chapterId, novelId, user.id]);
    } else if (!wantsLike && existing) {
      await client.query("DELETE FROM chapter_likes WHERE chapter_id=$1 AND user_id=$2", [chapterId, user.id]);
    }

    const liked = !!(await client.query("SELECT 1 FROM chapter_likes WHERE chapter_id=$1 AND user_id=$2", [chapterId, user.id])).rows[0];
    const likesCount = Number((await client.query("SELECT count(*)::int AS count FROM chapter_likes WHERE chapter_id=$1", [chapterId])).rows[0]?.count || 0);
    const { totalLikes: novelLikesCount } = await syncNovelLikeTotals(novelId, client);
    await client.query("COMMIT");
    res.json({ success: true, liked, likesCount, novelLikesCount, unlimited: true, usedToday: 0, dailyLimit: null });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(400).json({ error: "به‌روزرسانی پسند فصل انجام نشد." });
  } finally {
    client.release();
  }
});

router.post("/novels/:id/reviews", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { id } = req.params;
    const { rating, comment, content, ratingOverall, ratingStyle, ratingStory, ratingGrammar, ratingCharacter } = req.body;
    const username = user.username; // Force authentic identity
    if (!rating) return res.status(400).json({ error: "اطلاعات نقد کامل نیست." });

    // Ratings may only target novels the reviewer can actually see. This
    // prevents biasing metrics for pending/quarantined content and stops
    // orphan review rows against arbitrary IDs.
    const { data: reviewTargetNovel } = await supabase.from("novels").select("id, author_id, approval_status").eq("id", id).single();
    if (!reviewTargetNovel || !canUserViewNovel(reviewTargetNovel, user)) {
      return res.status(404).json({ error: "رمان یافت نشد." });
    }

    const clampRating = (value: any, fallback: number) => Math.max(1, Math.min(5, Number(value || fallback) || fallback));
    const overall = clampRating(ratingOverall ?? rating, rating);
    const style = clampRating(ratingStyle, overall);
    const story = clampRating(ratingStory, overall);
    const grammar = clampRating(ratingGrammar, overall);
    const character = clampRating(ratingCharacter, overall);
    const finalRating = Number(((overall + style + story + grammar + character) / 5).toFixed(1));

    // Fraud prevention with update support: If they already reviewed/rated, update it!
    const { data: existingReview } = await supabase.from('reviews').select('id, content').eq('novel_id', id).eq('user_id', user.id).single();
    
    const reviewContent = sanitizePlainText(comment || content || "", 5000);
    let reviewId = "";

    if (existingReview) {
      reviewId = existingReview.id;
      await supabase.from('reviews').update({
        user_id: user.id,
        rating: overall,
        rating_overall: overall,
        rating_style: style,
        rating_story: story,
        rating_grammar: grammar,
        rating_character: character,
        content: reviewContent || existingReview.content || "",
        created_at: new Date().toISOString()
      }).eq('id', reviewId);
    } else {
      reviewId = "rev-" + Date.now();
      await supabase.from('reviews').insert({
        id: reviewId,
        novel_id: id,
        user_id: user.id,
        username,
        rating: overall,
        rating_overall: overall,
        rating_style: style,
        rating_story: story,
        rating_grammar: grammar,
        rating_character: character,
        content: reviewContent
      });

      const criticCount = await incrementUserCounter(user.id, 'reviews_count');
      if (criticCount >= 25) {
        await checkAndAwardAchievement(user.id, 'ach_reader_critic');
      }
    }

    // Dynamic average rating recalculation and sync on novels table in database
    const { data: allReviews } = await supabase.from('reviews').select('rating').eq('novel_id', id);
    if (allReviews && allReviews.length > 0) {
      const totalRating = allReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
      const avgRating = parseFloat((totalRating / allReviews.length).toFixed(1));
      await supabase.from('novels').update({ rating: avgRating, reviews_count: allReviews.length }).eq('id', id);
    }
    await recordSuggestionStatsEvent(id, "comment").catch(() => {});
    const { data: novel } = await supabase.from('novels').select('author_id, title').eq('id', id).single();
    if (novel?.author_id && novel.author_id !== user.id) {
      await createUserNotification(
        novel.author_id,
        "novel_review",
        "نقد جدید",
        `${user.username} رمان ${novel.title} را نقد کرد.`,
        `/novels/${id}?review=${encodeURIComponent(reviewId)}`,
        "notify_ratings"
      );
      if (reviewContent) {
        await createUserNotification(
          novel.author_id,
          "novel_comment",
          "دیدگاه جدید",
          `${user.username} روی ${novel.title} دیدگاه گذاشت.`,
          `/novels/${id}?review=${encodeURIComponent(reviewId)}`,
          "notify_comments"
        );
      }
      await mirrorToInbox(
        novel.author_id,
        user.username,
        reviewContent ? `نقد جدید روی «${novel.title}»` : `امتیاز جدید برای «${novel.title}»`,
        (reviewContent || `امتیاز ${overall} از ۵`).slice(0, 200),
        `/novels/${id}`
      );
    }

    await invalidateCache("novels", id);
    const identity = buildPublicUserIdentity(user, user);
    res.json({
      success: true,
      review: {
        id: reviewId,
        userId: identity.userId,
        username: identity.username || username,
        displayName: identity.displayName,
        avatar: identity.avatar,
        role: identity.role,
        rating: finalRating,
        ratingOverall: overall,
        ratingStyle: style,
        ratingStory: story,
        ratingGrammar: grammar,
        ratingCharacter: character,
        comment: reviewContent,
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(400).json({ error: "ارسال نقد انجام نشد." });
  }
});

router.post("/authors/:username/support", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const targetUsername = sanitizePlainText(req.params.username, 80).trim();
    const amount = Math.max(1, Math.min(1000, Number(req.body.amount) || 0));
    const message = sanitizePlainText(req.body.message || "", 500);
    const novelId = req.body.novelId ? sanitizePlainText(req.body.novelId, 160) : null;
    if (!amount) return res.status(400).json({ error: "مبلغ حمایت باید حداقل 1 ستاره باشد." });
    const resolvedTarget = await resolveUsername(targetUsername);
    if (!resolvedTarget) return res.status(404).json({ error: "نویسنده یافت نشد." });

    const result = await db.withTransaction(async (client) => {
      const targetResult = await client.query(
        "SELECT id, username, coins, stars FROM users WHERE id = $1 FOR UPDATE",
        [resolvedTarget.id]
      );
      const target = targetResult.rows[0];
      if (!target) {
        const err = new Error("نویسنده یافت نشد.") as Error & { status?: number };
        err.status = 404;
        throw err;
      }
      if (target.id === user.id) {
        const err = new Error("نمی‌توانید به خودتان حمایت ارسال کنید.") as Error & { status?: number };
        err.status = 400;
        throw err;
      }

      const senderResult = await client.query(
        "SELECT id, username, coins FROM users WHERE id = $1 FOR UPDATE",
        [user.id]
      );
      const sender = senderResult.rows[0];
      if (!sender) {
        const err = new Error("دسترسی غیرمجاز.") as Error & { status?: number };
        err.status = 401;
        throw err;
      }
      const senderCoins = Number(sender.coins || 0);
      if (senderCoins < amount) {
        const err = new Error("سکه کافی ندارید.") as Error & { status?: number };
        err.status = 400;
        throw err;
      }

      await client.query("UPDATE users SET coins = $1 WHERE id = $2", [senderCoins - amount, user.id]);
      await client.query("UPDATE users SET stars = $1 WHERE id = $2", [Number(target.stars || 0) + amount, target.id]);
      await client.query(
        `INSERT INTO star_transactions (id, from_user_id, to_user_id, novel_id, amount, message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [`star-${uuidv4()}`, user.id, target.id, novelId, amount, message]
      );

      return { target, coins: senderCoins - amount };
    });

    await createUserNotification(
      result.target.id,
      "author_support",
      "حمایت جدید خواننده",
      `${user.username} به شما ${amount} ستاره هدیه داد${message ? `: ${message}` : "."}`,
      `/authors/${result.target.username}`,
      "notify_likes"
    );

    await checkAndAwardAchievement(user.id, "ach_reader_supporter");

    res.json({ success: true, coins: result.coins });
  } catch (err: any) {
    const msg = String(err?.message || "");
    res.status(err?.status && err?.status < 500 ? err.status : 500).json({
      error: msg && /[\u0600-\u06FF]/.test(msg) && msg.length < 300 ? msg : "ارسال حمایت انجام نشد."
    });
  }
});

router.get("/social", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!user) return res.json({ followers: [], following: [], blockedUsers: [] });
    res.json(await buildSocialPayload(user));
  } catch (err) {
    res.status(400).json({ error: "بارگذاری اطلاعات اجتماعی انجام نشد." });
  }
});

router.post("/social/follow", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const id = sanitizePlainText(req.body.id, 160).trim();
    const username = sanitizePlainText(req.body.username || req.body.targetUsername, 80).trim();
    const state = !!req.body.state;
    const targetUser = username
      ? await resolveUsername(username)
      : (await supabase.from('users').select('id, username').eq('id', id).single()).data;
    if (!targetUser || targetUser.id === user.id) return res.status(400).json({ error: "هدف دنبال‌کردن نامعتبر است." });

    if (state) {
      const { data: existingFollow } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('target_type', 'user')
        .eq('target_id', targetUser.id)
        .single();
      await supabase.from('follows').upsert({ id: `follow-${user.id}-${targetUser.id}`, follower_id: user.id, target_type: 'user', target_id: targetUser.id });
      if (!existingFollow) {
        await createUserNotification(
          targetUser.id,
          "new_follower",
          "دنبال‌کننده جدید",
          `${user.username} شما را دنبال کرد.`,
          `/authors/${user.username}`,
          "notify_followers"
        );
        const followersCount = await incrementUserCounter(targetUser.id, 'followers_count');
        if (followersCount >= 100) {
          await checkAndAwardAchievement(targetUser.id, 'ach_author_100followers');
        }
      }
    } else {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('target_type', 'user').eq('target_id', targetUser.id);
    }

    await invalidateSuggestionPreferences(user.id).catch(() => {});

    res.json({ success: true, ...(await buildSocialPayload(user)) });
  } catch (err) {
    res.status(400).json({ error: "به‌روزرسانی دنبال‌کردن انجام نشد." });
  }
});

router.post("/social/block", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { username, block } = req.body;
    if (!username) return res.status(400).json({ error: "کاربر مورد نظر برای مسدودسازی انتخاب نشده است." });
    const targetUser = await resolveUsername(username);
    if (!targetUser || targetUser.id === user.id) {
      return res.status(400).json({ error: "هدف مسدودسازی نامعتبر است." });
    }

    if (block) {
      await supabase.from('blocked_users').upsert({
        id: `b-${user.id}-${targetUser.id}`,
        blocker_user_id: user.id,
        blocked_user_id: targetUser.id,
        username: user.username,
        blocked_username: targetUser.username
      }, { onConflict: "blocker_user_id,blocked_user_id" });
    } else {
      await supabase.from('blocked_users').delete().eq('blocker_user_id', user.id).eq('blocked_user_id', targetUser.id);
    }

    res.json({ success: true, ...(await buildSocialPayload(user)) });
  } catch (err) {
    res.status(400).json({ error: "تغییر وضعیت مسدودسازی انجام نشد." });
  }
});

router.get("/settings", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
    res.setHeader("Vary", "Cookie");
    const user = await getActiveUser(req);
    let claimedAchievements: string[] = [];
    if (user) {
      // Fetch from new user_achievements table
      const { data: claims } = await supabase.from('user_achievements').select('achievement_id').eq('user_id', user.id);
      if (claims) {
        claimedAchievements = claims.map(c => c.achievement_id);
      }

      // Fallback
      const achKey = userAchievementSettingsKey(user.id);
      const { data: existingSettings } = await supabase.from('settings').select('setting_value').eq('setting_key', achKey).single();
      if (existingSettings && existingSettings.setting_value) {
        const fallbacks = JSON.parse(existingSettings.setting_value);
        fallbacks.forEach((f: string) => {
          if (!claimedAchievements.includes(f)) claimedAchievements.push(f);
        });
      }
    }

    const settings = await readSystemSettings();
    const normalizedRole = String(user?.role || "").toLowerCase().trim();
    const isAdmin = !!user && ["owner", "publisher"].includes(normalizedRole);
    
    res.json({
      claimedAchievements,
      systemSettings: Object.keys(settings).length ? redactPublicSettings(settings, isAdmin) : {
        maintenanceMode: false,
        announcement: "سامانه‌های عملیاتی عادی فعال هستند.",
        allowRegistration: true
      }
    });
  } catch (err) {
    res.status(400).json({ error: "دریافت تنظیمات سامانه انجام نشد." });
  }
});

router.post("/settings", enforceAdmin, async (req, res) => {
  try {
    await ensureEmailFeatureTables();
    const existing = await readSystemSettings();
    const next = sanitizeSystemSettingsTaxonomy({ ...(req.body || {}) });
    if ("rulesText" in next) next.rulesText = sanitizeHtml(String(next.rulesText || ""), {
      allowedTags: ["p", "br", "strong", "em", "u", "s", "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "ul", "ol", "li", "a"],
      allowedAttributes: { a: ["href", "target", "rel", "title"] },
      allowedSchemes: ["http", "https", "mailto"],
      transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }) }
    }).slice(0, 40000);
    if ("mainBannerTitle" in next) next.mainBannerTitle = sanitizePlainText(next.mainBannerTitle, 160);
    if ("mainBannerSubtitle" in next) next.mainBannerSubtitle = sanitizePlainText(next.mainBannerSubtitle, 160);
    if ("mainBannerDescription" in next) next.mainBannerDescription = sanitizePlainText(next.mainBannerDescription, 1000);
    if ("mainBannerImage" in next) {
      const bannerUrl = sanitizePlainText(next.mainBannerImage, 2000).trim();
      next.mainBannerImage = /^https:\/\//i.test(bannerUrl) || bannerUrl.startsWith("/uploads/") ? bannerUrl : "";
    }
    if (next.emailVerification) {
      const existingEmail = existing.emailVerification || {};
      const nextSmtp = next.emailVerification.smtp || {};
      const nextMailjet = next.emailVerification.mailjet || {};
      const nextResend = next.emailVerification.resend || {};
      next.emailVerification = {
        enabled: !!next.emailVerification.enabled,
        provider: normalizedEmailProvider(next.emailVerification.provider),
        smtp: {
          host: sanitizePlainText(nextSmtp.host, 255),
          port: Number(nextSmtp.port || 587),
          user: sanitizePlainText(nextSmtp.user, 255),
          pass: encryptedSettingValue(nextSmtp.pass, existingEmail.smtp?.pass),
          from: normalizedEmailOrDefault(nextSmtp.from),
          secure: !!nextSmtp.secure
        },
        mailjet: {
          apiKey: encryptedSettingValue(nextMailjet.apiKey, existingEmail.mailjet?.apiKey),
          secretKey: encryptedSettingValue(nextMailjet.secretKey, existingEmail.mailjet?.secretKey),
          from: normalizedEmailOrDefault(nextMailjet.from),
          fromName: sanitizePlainText(nextMailjet.fromName, 120).trim() || process.env.MAILJET_FROM_NAME || DEFAULT_FROM_NAME
        },
        resend: {
          apiKey: encryptedSettingValue(nextResend.apiKey, existingEmail.resend?.apiKey),
          from: normalizedEmailOrDefault(nextResend.from),
          fromName: sanitizePlainText(nextResend.fromName, 120).trim() || process.env.RESEND_FROM_NAME || DEFAULT_FROM_NAME
        }
      };
    }
    // Advertising was removed platform-wide. Any legacy `ad_*` setting is dead
    // configuration and must not be persisted again.
    for (const key of Object.keys(next)) {
      if (key.startsWith("ad_")) delete next[key];
    }
    const settingsWrite = await supabase.from('settings').upsert({ setting_key: 'systemSettings', setting_value: JSON.stringify(next) });
    if (settingsWrite.error) throw settingsWrite.error;
    await sharedCache.del("settings:system:v2");
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "به‌روزرسانی سیاست‌های مدیریتی انجام نشد." });
  }
});

router.post("/settings/test-email", enforceAdmin, async (req, res): Promise<any> => {
  try {
    await ensureEmailFeatureTables();
    const to = sanitizePlainText(req.body?.to, 254).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "یک آدرس ایمیل آزمایشی معتبر وارد کنید." });
    }

    const settings = await readSystemSettings();
    const emailVerification = settings.emailVerification || {};
    const { sendEmailWithAvailableConfig } = await import("../utils/email");
    const sent = await sendEmailWithAvailableConfig(
      prepareEmailConfig(emailVerification),
      to,
      "تست پیکربندی ایمیل رپتوک",
      "این یک ایمیل آزمایشی رپتوک است. پیکربندی ایمیل شما درست کار می‌کند.",
      "<p>این یک ایمیل آزمایشی رپتوک است.</p><p>پیکربندی ایمیل شما درست کار می‌کند.</p>"
    );

    if (!sent) return res.status(400).json({ error: "سرویس‌دهنده ایمیل، ایمیل آزمایشی را رد کرد. اعتبارنامه‌های SMTP/Mailjet/Resend و تأیید فرستنده/دامنه و لاگ‌ها را بررسی کنید." });
    res.json({ success: true });
  } catch (err: any) {
    const msg = String(err?.message || "");
    res.status(400).json({ error: msg && /[\u0600-\u06FF]/.test(msg) && msg.length < 300 ? msg : "ارسال ایمیل آزمایشی انجام نشد." });
  }
});

router.post("/profile/bio", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { bio } = req.body;
    if (typeof bio !== "string") {
      return res.status(400).json({ error: "قالب بیو نامعتبر است" });
    }

    const cleanBio = sanitizePlainText(bio, 1000);
    await supabase.from('users').update({ profile_bio: cleanBio }).eq('id', user.id);
    res.json({ success: true, bio: cleanBio });
  } catch (err) {
    res.status(400).json({ error: "به‌روزرسانی بیوگرافی پروفایل انجام نشد." });
  }
});

router.get("/authors/:username/links", async (req, res) => {
  try {
    await ensureAuthorLinksTable();
    const username = sanitizePlainText(req.params.username, 80).trim();
    const author = await resolveUsername(username);
    if (!author) return res.status(404).json({ error: "نویسنده یافت نشد." });
    const { data, error } = await supabase
      .from("author_profile_links")
      .select("id, platform, label, url, position")
      .eq("user_id", author.id)
      .order("position", { ascending: true });
    if (error) throw error;
    res.json({ links: data || [] });
  } catch {
    res.status(400).json({ error: "بارگذاری لینک‌های نویسنده انجام نشد." });
  }
});

router.post("/auth/profile/links", interactionLimiter, async (req, res) => {
  try {
    await ensureAuthorLinksTable();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    const url = normalizeAuthorLinkUrl(req.body?.url);
    const platform = sanitizePlainText(req.body?.platform || "website", 40).trim().toLowerCase();
    const label = sanitizePlainText(req.body?.label || platform, 80).trim();
    if (!url || !label) return res.status(400).json({ error: "یک لینک معتبر http یا https همراه با برچسب وارد کنید." });
    if (!supportedAuthorLinkPlatforms.has(platform)) return res.status(400).json({ error: "حمایت مالی، Patreon، YouTube، TikTok، X یا Instagram را انتخاب کنید." });
    const { count: platformCount } = await supabase.from("author_profile_links").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("platform", platform);
    if (Number(platformCount || 0) > 0) return res.status(400).json({ error: `لینک ${label} از قبل در این پروفایل وجود دارد. همان بخش موجود را ویرایش کنید.` });
    const { count } = await supabase.from("author_profile_links").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    if (Number(count || 0) >= 5) return res.status(400).json({ error: "هر پروفایل حداکثر 5 اتصال می‌تواند داشته باشد." });
    const payload = {
      id: `author-link-${uuidv4()}`,
      user_id: user.id,
      platform: platform || "website",
      label,
      url,
      position: Math.max(0, Math.min(1000, Number(req.body?.position ?? count ?? 0) || 0)),
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from("author_profile_links").insert(payload);
    if (error) throw error;
    res.status(201).json({ success: true, link: payload });
  } catch (err: any) {
    res.status(400).json({ error: err?.code === "23505" ? "این اتصال از قبل در پروفایل شما وجود دارد." : err?.code === "23514" ? "هر پروفایل حداکثر 5 اتصال می‌تواند داشته باشد." : "افزودن اتصال پروفایل انجام نشد." });
  }
});

router.patch("/auth/profile/links/:linkId", interactionLimiter, async (req, res) => {
  try {
    await ensureAuthorLinksTable();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    const linkId = sanitizePlainText(req.params.linkId, 160);
    const url = normalizeAuthorLinkUrl(req.body?.url);
    const platform = sanitizePlainText(req.body?.platform || "website", 40).trim().toLowerCase();
    const label = sanitizePlainText(req.body?.label || platform, 80).trim();
    if (!url || !label) return res.status(400).json({ error: "یک لینک معتبر http یا https همراه با برچسب وارد کنید." });
    if (!supportedAuthorLinkPlatforms.has(platform)) return res.status(400).json({ error: "حمایت مالی، Patreon، YouTube، TikTok، X یا Instagram را انتخاب کنید." });
    const { data: owned } = await supabase.from("author_profile_links").select("id").eq("id", linkId).eq("user_id", user.id).single();
    if (!owned) return res.status(404).json({ error: "لینک پروفایل یافت نشد." });
    const { data: duplicatePlatform } = await supabase.from("author_profile_links").select("id").eq("user_id", user.id).eq("platform", platform);
    if ((duplicatePlatform || []).some((link: any) => link.id !== linkId)) return res.status(400).json({ error: `لینک ${label} از قبل در این پروفایل وجود دارد. همان بخش موجود را ویرایش کنید.` });
    const { error } = await supabase.from("author_profile_links").update({ platform, label, url, updated_at: new Date().toISOString() }).eq("id", linkId).eq("user_id", user.id);
    if (error) throw error;
    res.json({ success: true, link: { id: linkId, platform, label, url } });
  } catch (err: any) {
    res.status(400).json({ error: err?.code === "23505" ? "این لینک از قبل در پروفایل شما وجود دارد." : "به‌روزرسانی لینک پروفایل انجام نشد." });
  }
});

router.delete("/auth/profile/links/:linkId", interactionLimiter, async (req, res) => {
  try {
    await ensureAuthorLinksTable();
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "نشست شما معتبر نیست." });
    const linkId = sanitizePlainText(req.params.linkId, 160);
    const { data: owned } = await supabase.from("author_profile_links").select("id").eq("id", linkId).eq("user_id", user.id).single();
    if (!owned) return res.status(404).json({ error: "لینک پروفایل یافت نشد." });
    const { error } = await supabase.from("author_profile_links").delete().eq("id", linkId).eq("user_id", user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف لینک پروفایل انجام نشد." });
  }
});

// Editor/Moderation Routes
router.get("/admin/novels", enforceAdmin, async (req, res) => {
  try {
    const { data: novels } = await supabase.from('novels').select('*').order('created_at', { ascending: false });
    res.json(novels || []);
  } catch (err) {
    res.status(400).json({ error: "دریافت رمان‌ها انجام نشد" });
  }
});

router.get("/admin/novels/:novelId/detailed-chapters", enforceAdmin, async (req, res) => {
  try {
    const { data: chapters } = await supabase.from('chapters').select('*').eq('novel_id', req.params.novelId).order('chapter_number', { ascending: true });
    res.json(chapters || []);
  } catch (err) {
    res.status(400).json({ error: "دریافت فصل‌ها انجام نشد" });
  }
});

router.post("/admin/novels/:novelId/moderate", enforceAdmin, async (req, res) => {
  try {
    const { status, note } = req.body;
    await supabase.from('novels').update({ approval_status: status, editor_note: sanitizePlainText(note || '', 2000) }).eq('id', req.params.novelId);
    
    // Also notify author if note
    if (note) {
      const { data: novel } = await supabase.from('novels').select('author_id, author, title').eq('id', req.params.novelId).single();
      if (novel && novel.author_id) {
        await createUserNotification(
          novel.author_id,
          "editor_update",
          "به‌روزرسانی تحریریه",
          `رمان شما با عنوان '${novel.title}' ${status === "approved" ? "تأیید شد" : "رد شد"}. پیام ویرایشگر: ${note}`,
          `/novels/${encodeURIComponent(req.params.novelId)}`
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "بررسی رمان انجام نشد" });
  }
});

router.get("/admin/novels/:novelId/messages", enforceAdmin, async (req, res) => {
  try {
    const { data: messages } = await supabase.from('editor_messages')
      .select('*').eq('novel_id', req.params.novelId).order('created_at', { ascending: true });
    res.json(messages || []);
  } catch (err) {
    res.status(400).json({ error: "دریافت پیام‌ها انجام نشد" });
  }
});

router.post("/admin/novels/:novelId/messages", enforceAdmin, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { data: novel } = await supabase.from('novels').select('author_id').eq('id', req.params.novelId).single();
    if (!novel?.author_id) return res.status(404).json({ error: "رمان یافت نشد" });

    await supabase.from('editor_messages').insert({
      id: `nem-${Date.now()}-${uuidv4().substring(0, 5)}`,
      novel_id: req.params.novelId,
      sender_id: user.id,
      receiver_id: novel.author_id,
      content: String(req.body.content || "").slice(0, 10000)
    });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ذخیره پیام انجام نشد" });
  }
});

router.delete("/admin/novels/:novelId/chapters/:chapterId", enforceAdmin, async (req, res) => {
  try {
    await supabase.from('chapters').delete().eq('id', req.params.chapterId).eq('novel_id', req.params.novelId);
    await invalidateCache("novels", req.params.novelId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "حذف فصل انجام نشد" });
  }
});

router.post("/admin/novels/:novelId/chapters/:chapterId/note", enforceAdmin, async (req, res) => {
  try {
    await supabase.from('chapters').update({ editor_note: req.body.note }).eq('id', req.params.chapterId).eq('novel_id', req.params.novelId);
    await invalidateCache("novels", req.params.novelId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "افزودن یادداشت فصل انجام نشد" });
  }
});

router.use((req, res) => {
  res.status(404).json({ error: "مسیر API یافت نشد." });
});

router.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // ✅ Global error handler - don't expose internal details
  const isDev = process.env.NODE_ENV === 'development';
  const isUnsupportedImageType = err?.code === "IMAGE_TYPE_UNSUPPORTED" || /invalid file type|avatar must|unsupported.*type|نوع فایل پشتیبانی نمی‌شود/i.test(String(err?.message || ""));
  const isExpectedUploadRejection = err?.code === "LIMIT_FILE_SIZE" || isUnsupportedImageType;

  // Multer reports rejected client input through Express' error path. It is a
  // normal 4xx response, not an undefined-status server failure.
  if (!isExpectedUploadRejection) {
    console.error('Server error:', {
      message: err?.message || err,
      code: err?.code,
      status: err?.status,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  }
  
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      error: "حجم داده ارسالی بیش از حد مجاز است. تصویر جلد یا فصل کوچک‌تری استفاده کنید و دوباره تلاش کنید.",
      code: "PAYLOAD_TOO_LARGE"
    });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "حجم فایل انتخاب‌شده بیش از حد مجاز است. تصویری کوچک‌تر از حد نمایش‌داده‌شده استفاده کنید.",
      code: "IMAGE_TOO_LARGE"
    });
  }
  if (isUnsupportedImageType) {
    return res.status(415).json({
      error: "این نوع تصویر پشتیبانی نمی‌شود. تصویری با قالب JPEG، PNG، WebP، GIF یا AVIF انتخاب کنید.",
      code: "IMAGE_TYPE_UNSUPPORTED"
    });
  }

  // Return generic error to client
  res.status(err?.status || 500).json({
    error: "خطایی رخ داد. لطفاً بعداً دوباره تلاش کنید.",
    ...(isDev ? { message: err?.message, code: err?.code } : {})
  });
});

export default router;
