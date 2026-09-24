import { Novel, Review, type ReadingProgress } from "../types";
import type { MangaPage, MangaPageInput } from "../../shared/manga";
import { dedupeAchievementNotifications } from "./achievementNotifications";
import { normalizeReadingSessionMetrics } from "../../shared/readingAnalytics";
import { getOfflineNovel, getOfflineNovels } from "./offlineLibrary";

const AUTH_TOKEN_STORAGE_KEY = "reptoc-auth-token";
const memoryCache = new Map<string, { expiresAt: number; value: any }>();
const inFlightRequests = new Map<string, Promise<any>>();
const trackedEvents = new Map<string, number>();
const MAX_MEMORY_CACHE_ENTRIES = 250;

// ✅ SECURITY: Validate user IDs before interpolating into URLs or sending
// to the suggestion API. Prevents `?userId=undefined` or arbitrary payloads.
const ANON_ID_PATTERN = /^anon-[a-f0-9]{32}$/i;
const AUTHENTICATED_USER_ID_PATTERN = /^(u-[a-f0-9-]{8,80}|admin-master-[a-f0-9-]{8,80}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
function isValidUserId(value: unknown, allowAnon: boolean): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) return false;
  if (allowAnon && ANON_ID_PATTERN.test(value)) return true;
  return AUTHENTICATED_USER_ID_PATTERN.test(value);
}

// ✅ SECURITY: Bound the total byte size of the in-memory cache.
// Without this, a popular page could push hundreds of MB into memory and
// crash mobile browsers (out-of-memory).
const MAX_MEMORY_CACHE_BYTES = Number(process.env.VITE_CACHE_MAX_BYTES || 16 * 1024 * 1024); // 16MB
let currentCacheBytes = 0;

function estimateBytes(value: any): number {
  try {
    return JSON.stringify(value).length * 2; // UTF-16 in JS strings
  } catch {
    return 1024;
  }
}

function setMemoryCache(key: string, value: any, ttlMs: number) {
  // Remove existing entry first (and refund its bytes).
  const existing = memoryCache.get(key);
  if (existing) {
    currentCacheBytes -= estimateBytes(existing.value);
  }
  memoryCache.delete(key);

  const entryBytes = estimateBytes(value);
  // ✅ SECURITY: Refuse to cache items larger than 1MB individually.
  if (entryBytes > 1024 * 1024) {
    return;
  }

  memoryCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  currentCacheBytes += entryBytes;

  // Evict oldest entries until we're under both the byte budget AND the count budget.
  while (memoryCache.size > 0 && (currentCacheBytes > MAX_MEMORY_CACHE_BYTES || memoryCache.size > MAX_MEMORY_CACHE_ENTRIES)) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = memoryCache.get(oldestKey);
    if (oldest) currentCacheBytes -= estimateBytes(oldest.value);
    memoryCache.delete(oldestKey);
  }
}

async function cachedJson<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value as T;
  if (cached) memoryCache.delete(key);
  const inFlight = inFlightRequests.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const request = fetcher()
    .then((value) => {
      setMemoryCache(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });
  inFlightRequests.set(key, request);
  return request;
}

function invalidateMemoryCache(prefix: string) {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
}

function removeLegacyStoredAuthToken() {
  try {
    window.localStorage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
    window.sessionStorage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {}
}

removeLegacyStoredAuthToken();

export async function checkServerStatus(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

async function readApiJson(res: Response): Promise<any> {
  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (data?.success && data?.csrfToken && !data.token) data.token = data.csrfToken;
  if (!res.ok && !data.error) {
    data.error = res.status === 401
      ? "نام کاربری یا رمز عبور نادرست است."
      : `درخواست ناموفق بود (${res.status}). لطفا دوباره تلاش کنید.`;
  }
  return data;
}

function friendlyNetworkError(err: any): string {
  if (err?.name === "AbortError") return "زمان درخواست به پایان رسید. لطفا دوباره تلاش کنید.";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "اتصال اینترنت برقرار نیست. لطفا اتصال را وصل کرده و دوباره تلاش کنید.";
  return "اتصال به سرور ممکن نشد. لطفا صفحه را تازه‌سازی کنید یا چند لحظه بعد دوباره تلاش کنید.";
}

export const api = {
  isOnline() {
    return checkServerStatus();
  },

  async getNovels(fallbackData?: any[]): Promise<Novel[]> {
    // Revalidate on every page refresh. The browser may use a 304 response,
    // while the server cache prevents the validation from hitting the database.
    try {
      const res = await fetch("/api/novels?view=catalog", { cache: "no-cache", credentials: "same-origin" });
      if (res.ok) return await res.json();
    } catch {}
    const offline = await getOfflineNovels().catch(() => []);
    return offline.length ? offline : fallbackData || [];
  },

  async getNovel(novelId: string): Promise<Novel | null> {
    try {
      const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}`, { cache: "no-cache", credentials: "same-origin" });
      if (res.ok) return await res.json();
      if (res.status === 404 || res.status === 403) return null;
    } catch {}
    return getOfflineNovel(novelId).catch(() => null);
  },

  async getWriterNovelStats(): Promise<Array<{
    novelId: string; title: string; coverUrl: string; viewsCount: number;
    likesCount: number; commentsCount: number; reviewsCount: number;
    avgRating: number; totalEngagement: number;
  }>> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers["X-CSRF-Token"] = token;
    const res = await fetch("/api/writer/novel-stats", { headers, credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error(`بارگذاری آمار رمان‌ها ناموفق بود (${res.status})`);
    const body = await res.json();
    return Array.isArray(body?.stats) ? body.stats : [];
  },

  async getCharacterVotes(novelId: string): Promise<{
    votes: Record<string, number>;
    votedCharacterIds: string[];
    votesUsedToday: number;
    votesRemainingToday: number;
  }> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/character-votes`, {
      cache: "no-store",
      credentials: "same-origin"
    });
    const body = await readApiJson(res);
    if (!res.ok) throw new Error(body?.error || "بارگیری آرا شخصیت‌ها ممکن نشد.");
    return body;
  },

  async voteForCharacter(novelId: string, characterId: string): Promise<{
    votes: Record<string, number>;
    votedCharacterIds: string[];
    votesUsedToday: number;
    votesRemainingToday: number;
  }> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-CSRF-Token"] = token;
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/character-votes`, {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ characterId })
    });
    const body = await readApiJson(res);
    if (!res.ok) throw new Error(body?.error || "ثبت رأی شما برای شخصیت ممکن نشد.");
    return body;
  },

  async getRecommendedNovels(userId: string, device: string = "desktop", genre: string = ""): Promise<Novel[]> {
    // ✅ SECURITY: Validate userId before interpolating into URL.
    // Prevents `?userId=undefined` or `?userId=<malicious>` from being sent.
    if (!isValidUserId(userId, true)) {
      return [];
    }
    const safeUserId = encodeURIComponent(userId);
    const safeDevice = encodeURIComponent(device);
    const safeGenre = encodeURIComponent(genre);
    return cachedJson(`recommend:${safeUserId}:${safeDevice}:${safeGenre}`, 60_000, async () => {
      const genreQuery = safeGenre ? `&genre=${safeGenre}` : "";
      const res = await fetch(`/api/suggestion/recommend?userId=${safeUserId}&device=${safeDevice}${genreQuery}`, {
        credentials: "same-origin"
      });
      if (res.ok) {
        return await res.json();
      }
      return [];
    });
  },

  async trackEvent(userId: string, novelId: string, event: string, readTime: number = 0, chapter: number = 0): Promise<boolean> {
    // ✅ SECURITY: Validate both IDs before sending.
    if (!isValidUserId(userId, true) || !novelId || typeof novelId !== "string") {
      return false;
    }

    const dedupeKey = `${userId}:${novelId}:${event}:${chapter}`;
    const dedupeWindow = event === "impression" ? 5 * 60_000 : event === "read_time" ? 15_000 : 2_000;
    const lastTrackedAt = trackedEvents.get(dedupeKey) || 0;
    if (Date.now() - lastTrackedAt < dedupeWindow) return true;
    trackedEvents.set(dedupeKey, Date.now());

    const headers = this.authHeaders(true);
    const response = await fetch("/api/suggestion/event", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ userId, novelId, event, readTime, chapter })
    });
    if (!response.ok) return false;
    // Only preference-changing signals should evict recommendations. Frequent
    // impressions/read-time events otherwise destroy nearly every cache hit.
    if (["favorite", "follow", "unfollow", "library_add", "remove_from_library", "not_interested", "chapter_complete"].includes(event)) {
      invalidateMemoryCache(`recommend:${encodeURIComponent(userId)}:`);
    }
    return true;
  },

  /**
   * ✅ SECURITY: Reads CSRF token from BOTH cookie names.
   *
   * The backend sets the cookie under:
   *   - `__Host-XSRF-TOKEN` in production (with Secure + __Host- prefix)
   *   - `XSRF-TOKEN` in development (HTTP localhost cannot use __Host-)
   *
   * This reader checks both, so the frontend works in both environments
   * without code changes.
   */
  getToken(): string | null {
    const cookies = document.cookie.split("; ");
    // Look for __Host-XSRF-TOKEN first (preferred, more secure), then fall back.
    const cookie = cookies.find(row => row.startsWith("__Host-XSRF-TOKEN="))
      || cookies.find(row => row.startsWith("XSRF-TOKEN="));
    if (!cookie) return null;
    // The cookie value may contain `=` (base64 padding), so join the rest.
    const value = cookie.split("=").slice(1).join("=");
    return value ? decodeURIComponent(value) : null;
  },

  /**
   * ✅ SECURITY: No-op stub. The CSRF token is managed entirely via the cookie
   * set by the server. We do NOT store it in localStorage or sessionStorage —
   * that would create an additional attack surface.
   *
   * This method is kept for backward compatibility with callers, but it only
   * cleans up any legacy storage from older versions.
   */
  setToken(_token: string, _rememberMe = true): void {
    removeLegacyStoredAuthToken();
  },

  clearToken(): void {
    removeLegacyStoredAuthToken();
  },

  authHeaders(json = false): Record<string, string> {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (json) headers["Content-Type"] = "application/json";
    if (token) {      headers["X-CSRF-Token"] = token;
    }
    return headers;
  },

  async saveNovel(novel: Novel): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-CSRF-Token"] = token;
    
    const res = await fetch("/api/novels", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(novel)
    });
    if (!res.ok) {
      let message = `ذخیره رمان ناموفق بود (HTTP ${res.status}).`;
      try {
        const body = await res.json();
        const diagnostic = [
          body?.source ? `منبع: ${body.source}` : "",
          body?.code ? `کد: ${body.code}` : "",
          body?.field ? `فیلد: ${body.field}` : "",
          body?.detail && body.detail !== body?.error ? `جزئیات: ${body.detail}` : "",
          body?.requestId ? `درخواست: ${body.requestId}` : ""
        ].filter(Boolean).join(" · ");
        const guidance = res.status === 401
          ? " دوباره وارد شوید و سپس دوباره تلاش کنید. پیش‌نویس شما در همین صفحه باقی می‌ماند."
          : res.status === 403
            ? " مجوزهای انتشار حساب خود یا تأیید ایمیل را بررسی کنید."
            : res.status === 422
              ? " دسته‌بندی‌ها و رده‌بندی‌های مشخص‌شده رمان را بازبینی کنید."
              : res.status >= 500
                ? " سرور موقتا در دسترس نیست؛ چند لحظه صبر کنید و دوباره تلاش کنید."
                : " فیلد مشخص‌شده را اصلاح کنید و دوباره تلاش کنید. پیش‌نویس شما از بین نرفته است.";
        message = `${body?.error || message}${guidance}${diagnostic ? ` عیب‌یابی: ${diagnostic}.` : ""}`;
      } catch {
        message += " سرور پاسخی غیرقابل خواندن برگرداند. پیش‌نویس شما در همین صفحه باقی می‌ماند؛ چند لحظه بعد دوباره تلاش کنید.";
      }
      throw new Error(message);
    }
  },

  async updateNovel(novel: Novel): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-CSRF-Token"] = token;

    const res = await fetch(`/api/novels/${encodeURIComponent(novel.id)}`, {
      method: "PUT",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({
        title: novel.title,
        author: novel.author,
        coverUrl: novel.coverUrl || novel.cover,
        description: novel.description,
        status: novel.status,
        genre: novel.genre,
        isCompleted: novel.isCompleted,
        tags: novel.tags,
        warnings: novel.warnings,
        mainCategories: novel.mainCategories,
        subCategories: novel.subCategories,
        ageRating: novel.ageRating,
        characters: novel.characters,
        isAIGenerated: novel.isAIGenerated,
        isAIAssisted: novel.isAIAssisted,
        originType: novel.originType,
        originalAuthor: novel.originalAuthor,
        translators: novel.translators,
        // `contentKind` is deliberately omitted: the server rejects a change and
        // an in-memory novel loaded from the catalogue may not carry it.
        readingDirection: novel.readingDirection,
        premiumPresentation: novel.premiumPresentation,
        preventCopy: novel.preventCopy === true,
        preventScreenshot: novel.preventScreenshot === true
      })
    });
    if (!res.ok) {
      let message = "به‌روزرسانی جزئیات رمان ناموفق بود.";
      try {
        const body = await res.json();
        const guidance = res.status === 401
          ? " دوباره وارد شوید و سپس دوباره تلاش کنید."
          : res.status === 403
            ? " فقط حساب مالک این رمان می‌تواند آن را ویرایش کند."
            : res.status === 422
              ? " ژانر، دسته‌بندی‌ها، هشدارها و رده سنی انتخاب‌شده را بازبینی کنید."
              : " تغییرات شما از بین نرفته است؛ لطفا دوباره تلاش کنید.";
        message = `${body?.error || message}${guidance}`;
      } catch {}
      throw new Error(message);
    }
  },

  async updateNovelCover(novelId: string, coverUrl: string): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-CSRF-Token"] = token;

    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}`, {
      method: "PUT",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ coverUrl }),
    });
    if (!res.ok) {
      const body = await readApiJson(res);
      throw new Error(body?.error || "افزودن جلد بارگذاری‌شده به این رمان ممکن نشد.");
    }
  },

  async saveChapter(token: string, novelId: string, chapter: any): Promise<any> {
    try {
      const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token
        },
        credentials: "same-origin",
        body: JSON.stringify(chapter)
      });
      const data = await readApiJson(res);
      return res.ok ? data : { success: false, error: data?.error || "ذخیره فصل ناموفق بود." };
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  /**
   * Manga pages.
   *
   * The page list is always sent whole: that is what makes reordering,
   * deleting, replacing an image and editing captions a single atomic write
   * instead of a batch of per-page mutations that can half-apply.
   */
  async getMangaPages(novelId: string, chapterId: string): Promise<{
    pages: MangaPage[];
    pageCount: number;
    readingDirection: "rtl" | "ltr";
    limits: { maxPages: number };
  }> {
    const res = await fetch(
      `/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/pages`,
      { credentials: "same-origin", cache: "no-store" },
    );
    const body = await readApiJson(res);
    if (!res.ok) throw new Error(body?.error || "بارگذاری صفحه‌های این فصل ممکن نشد.");
    return {
      pages: Array.isArray(body?.pages) ? body.pages : [],
      pageCount: Number(body?.pageCount || 0),
      readingDirection: body?.readingDirection === "ltr" ? "ltr" : "rtl",
      limits: { maxPages: Number(body?.limits?.maxPages || 200) },
    };
  },

  async saveMangaPages(novelId: string, chapterId: string, pages: MangaPageInput[]): Promise<{ pages: MangaPage[]; pageCount: number }> {
    const res = await fetch(
      `/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/pages`,
      {
        method: "PUT",
        headers: this.authHeaders(true),
        credentials: "same-origin",
        body: JSON.stringify({ pages }),
      },
    );
    const body = await readApiJson(res);
    if (!res.ok) throw new Error(body?.error || "ذخیره صفحه‌های این فصل ممکن نشد.");
    return { pages: Array.isArray(body?.pages) ? body.pages : [], pageCount: Number(body?.pageCount || 0) };
  },

  async appendMangaPages(novelId: string, chapterId: string, pages: MangaPageInput[]): Promise<{ pages: MangaPage[]; pageCount: number }> {
    const res = await fetch(
      `/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/pages`,
      {
        method: "POST",
        headers: this.authHeaders(true),
        credentials: "same-origin",
        body: JSON.stringify({ pages }),
      },
    );
    const body = await readApiJson(res);
    if (!res.ok) throw new Error(body?.error || "افزودن صفحه‌ها ممکن نشد.");
    return { pages: Array.isArray(body?.pages) ? body.pages : [], pageCount: Number(body?.pageCount || 0) };
  },

  async deleteMangaPage(novelId: string, chapterId: string, pageId: string): Promise<{ pages: MangaPage[]; pageCount: number }> {
    const res = await fetch(
      `/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/pages/${encodeURIComponent(pageId)}`,
      { method: "DELETE", headers: this.authHeaders(), credentials: "same-origin" },
    );
    const body = await readApiJson(res);
    if (!res.ok) throw new Error(body?.error || "حذف این صفحه ممکن نشد.");
    return { pages: Array.isArray(body?.pages) ? body.pages : [], pageCount: Number(body?.pageCount || 0) };
  },

  async getMangaPageCounts(novelId: string): Promise<Record<string, number>> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/page-counts`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await readApiJson(res);
    return res.ok && body?.counts && typeof body.counts === "object" ? body.counts : {};
  },

  async deleteChapter(token: string, novelId: string, chapterId: string): Promise<boolean> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`, {
      method: "DELETE",
      headers: {
        "X-CSRF-Token": token
      },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async getChapterComments(novelId: string, chapterId: string): Promise<any[]> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/comments`);
    if (res.ok) {
      const data = await readApiJson(res);
      return data.comments || [];
    }
    return [];
  },

  async addChapterComment(token: string, novelId: string, chapterId: string, content: string, parentId?: string): Promise<any> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ content, parentId })
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { success: false, error: data?.error || "ارسال دیدگاه فصل ناموفق بود." };
  },

  async getParagraphCommentCounts(novelId: string, chapterId: string): Promise<Record<string, number>> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/paragraph-comments/counts`, { credentials: "same-origin" });
    const data = await readApiJson(res);
    return res.ok && data?.counts ? data.counts : {};
  },

  async getParagraphComments(novelId: string, chapterId: string, paragraphId: string, cursor?: string): Promise<any> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/paragraphs/${encodeURIComponent(paragraphId)}/comments${query}`, { credentials: "same-origin" });
    const data = await readApiJson(res);
    return res.ok ? data : { comments: [], nextCursor: null, error: data?.error || "بارگیری دیدگاه‌های پاراگراف ناموفق بود." };
  },

  async addParagraphComment(token: string, novelId: string, chapterId: string, paragraphId: string, content: string, parentId?: string): Promise<any> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/paragraphs/${encodeURIComponent(paragraphId)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ content, parentId })
    });
    const data = await readApiJson(res);
    return res.ok ? data : { success: false, error: data?.error || "ارسال دیدگاه پاراگراف ناموفق بود." };
  },

  async editChapterComment(token: string, novelId: string, chapterId: string, commentId: string, content: string): Promise<any> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/comments/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ content })
    });
    const data = await readApiJson(res);
    return res.ok ? data : { success: false, error: data?.error || "ویرایش دیدگاه ناموفق بود." };
  },

  async deleteChapterComment(token: string, novelId: string, chapterId: string, commentId: string): Promise<any> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    const data = await readApiJson(res);
    return res.ok ? data : { success: false, error: data?.error || "حذف دیدگاه ناموفق بود." };
  },

  async setChapterCommentLike(token: string, novelId: string, chapterId: string, commentId: string, liked: boolean): Promise<any> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/comments/${encodeURIComponent(commentId)}/like`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ liked })
    });
    const data = await readApiJson(res);
    return res.ok ? data : { success: false, error: data?.error || "به‌روزرسانی پسند دیدگاه ناموفق بود." };
  },

  async submitReport(token: string, payload: { targetType: string; targetId: string; reason: string; details?: string }): Promise<any> {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await readApiJson(res);
    return res.ok ? data : { success: false, error: data?.error || "ارسال گزارش ناموفق بود." };
  },

  async restoreChapterVersion(token: string, novelId: string, chapterId: string, versionId: string): Promise<boolean> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/restore`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ versionId })
    });
    return res.ok;
  },

  async deleteChapterVersion(token: string, novelId: string, chapterId: string, versionId: string): Promise<boolean> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/versions/${encodeURIComponent(versionId)}`, {
      method: "DELETE",
      headers: {
        "X-CSRF-Token": token
      },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async getChapterVersions(token: string, novelId: string, chapterId: string): Promise<any[]> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/versions`, {
      headers: {
        "X-CSRF-Token": token
      },
      credentials: "same-origin"
    });
    if (res.ok) {
      const data = await res.json();
      return data.versions || [];
    }
    return [];
  },

  async startPremiumCheckout(token: string, months: number, premiumType: "reader" | "writer" = "reader"): Promise<any> {
    const res = await fetch("/api/premium/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ months, premiumType })
    });
    return await res.json();
  },

  async confirmPremiumCheckout(token: string, sessionId: string): Promise<any> {
    const res = await fetch("/api/premium/stripe-confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ sessionId })
    });
    return await res.json();
  },

  async deleteNovel(id: string): Promise<{ success: boolean; error?: string }> {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) headers["X-CSRF-Token"] = token;

    const res = await fetch(`/api/novels/${encodeURIComponent(id)}`, { 
      method: "DELETE",
      headers,
      credentials: "same-origin"
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { success: true, ...data } : { success: false, error: data?.error || "حذف رمان ناموفق بود." };
  },

  async saveAllNovels(novelsList: Novel[]): Promise<void> {
    const token = this.getToken();
    if (!token) return;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    headers["X-CSRF-Token"] = token;
    await fetch(`/api/novels/bulk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ novels: novelsList }),
      credentials: "same-origin"
    });
  },

  async addReview(novelId: string, review: Review): Promise<any> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["X-CSRF-Token"] = token;    }

    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/reviews`, {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(review)
    });
    if (res.ok) {
      return await res.json();
    }
    const data = await readApiJson(res);
    return { success: false, error: data?.error || "ذخیره امتیاز یا نقد ناموفق بود." };
  },

  async getSocial(): Promise<{ followers: any[]; following: any[]; blockedUsers: string[] }> {
    const res = await fetch("/api/social");
    if (res.ok) return await res.json();
    return { followers: [], following: [], blockedUsers: [] };
  },

  async saveSocialRelation(id: string, type: "follower" | "following", state: boolean, username?: string): Promise<any> {
    const headers = this.authHeaders(true);
    const res = await fetch("/api/social/follow", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ id, username, type, state })
    });
    if (res.ok) {
      invalidateMemoryCache("recommend:");
      return await res.json();
    }
    return null;
  },

  async saveBlockedUsers(username: string, block: boolean): Promise<string[]> {
    const headers = this.authHeaders(true);
    const res = await fetch("/api/social/block", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ username, block })
    });
    if (res.ok) {
      const data = await res.json();
      return data.blockedUsers;
    }
    return [];
  },

  async getSettings(): Promise<{ claimedAchievements: string[]; systemSettings: any }> {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) {      headers["X-CSRF-Token"] = token;
    }
    const res = await fetch("/api/settings", { headers, credentials: "same-origin" });
    if (res.ok) return await res.json();
    return { claimedAchievements: [], systemSettings: {} };
  },

  async getPreferences(): Promise<any> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-CSRF-Token"] = token;

    const res = await fetch("/api/auth/preferences", { headers, credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      return data.preferences;
    }
    return { subgenres: [] };
  },

  async savePreferences(preferences: any): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-CSRF-Token"] = token;
    
    await fetch("/api/auth/preferences", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ preferences })
    });
  },

  async saveSystemSettings(settings: any): Promise<void> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {      headers["X-CSRF-Token"] = token;
    }
    const response = await fetch("/api/settings", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(settings)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "ذخیره تنظیمات ناموفق بود.");
    }
  },

  async sendTestEmail(to: string): Promise<any> {
    const token = this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-CSRF-Token"] = token;
    try {
      const res = await fetch("/api/settings/test-email", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ to })
      });
      return await readApiJson(res);
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },


  async getAchievements(): Promise<any[]> {
    const res = await fetch("/api/achievements");
    if (res.ok) return await res.json();
    return [];
  },

  async grantAchievement(token: string, userId: string, achievementId: string): Promise<boolean> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/achievements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ achievementId })
    });
    return res.ok;
  },

  async getAdminAudit(token: string): Promise<any[]> {
    const res = await fetch("/api/admin/audit", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (res.ok) return await res.json();
    return [];
  },

  async getMonitorMetrics(token: string): Promise<any|null> {
    const res = await fetch('/api/monitor/metrics', { headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    if (res.ok) return await res.json();
    return null;
  },

  async getAdminAuditFiles(token: string): Promise<any[]> {
    const res = await fetch('/api/admin/audit/files', { headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    if (res.ok) return await res.json();
    return [];
  },

  async getAdminAuditFileContent(token: string, filename: string): Promise<string | null> {
    const res = await fetch(`/api/admin/audit/files/${encodeURIComponent(filename)}`, { headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    if (res.ok) return await res.text();
    return null;
  },

  async deleteAdminAuditFile(token: string, filename: string): Promise<boolean> {
    const res = await fetch(`/api/admin/audit/files/${encodeURIComponent(filename)}`, { method: 'DELETE', headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    return res.ok;
  },

  async exportUsersCsv(token: string): Promise<string | null> {
    const res = await fetch('/api/admin/users/export/csv', { headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    if (res.ok) return await res.text();
    return null;
  },

  async importUsersCsv(token: string, csv: string): Promise<any> {
    const res = await fetch('/api/admin/users/import/csv', { method: 'POST', headers: { "Content-Type": 'application/json', "X-CSRF-Token": token }, credentials: 'same-origin', body: JSON.stringify({ csv }) });
    if (res.ok) return await res.json();
    return null;
  },

  async createBackup(token: string): Promise<any> {
    const res = await fetch('/api/admin/backups/create', { method: 'POST', headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    if (res.ok) return await res.json();
    return null;
  },

  async getBackups(token: string): Promise<any[]> {
    const res = await fetch('/api/admin/backups/files', { headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    if (res.ok) return await res.json();
    return [];
  },

  async getBackupFile(token: string, filename: string): Promise<string | null> {
    const res = await fetch(`/api/admin/backups/files/${encodeURIComponent(filename)}`, { headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    if (res.ok) return await res.text();
    return null;
  },

  async deleteBackupFile(token: string, filename: string): Promise<boolean> {
    const res = await fetch(`/api/admin/backups/files/${encodeURIComponent(filename)}`, { method: 'DELETE', headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    return res.ok;
  },

  async adminGenerate2FA(token: string, userId: string): Promise<any> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/2fa/generate`, { method: 'POST', headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    if (res.ok) return await res.json();
    return null;
  },

  async adminDisable2FA(token: string, userId: string): Promise<boolean> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/2fa/disable`, { method: 'POST', headers: { "X-CSRF-Token": token }, credentials: 'same-origin' });
    return res.ok;
  },

  async claimAchievement(id: string): Promise<string[]> {
    const headers = this.authHeaders(true);
    const res = await fetch("/api/achievements/claim", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      const data = await res.json();
      return data.claimedAchievements || (data.claimedAchievement ? [data.claimedAchievement] : []);
    }
    return [];
  },

  async register(username, password, nickname?: string, email?: string, phone?: string): Promise<any> {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password, nickname, email, phone })
      });
      const data = await readApiJson(res);
      if (data?.success && data?.csrfToken) this.setToken(data.csrfToken, true);
      return data;
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  async login(username, password, rememberMe = true): Promise<any> {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password, rememberMe })
      });
      const data = await readApiJson(res);
      
      // ✅ NEW: Handle 2FA requirement
      if (data.requiresOTP) {
        return {
          success: false,
          requiresOTP: true,
          otpSessionToken: data.otpSessionToken,
          userId: data.userId,
          message: data.message
        };
      }

      if (data?.success && data?.csrfToken) this.setToken(data.csrfToken, rememberMe !== false);
      
      return data;
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  startGoogleAuth(action: "login" | "link" = "login") {
    window.location.assign(`/api/auth/google?action=${encodeURIComponent(action)}`);
  },

  async disconnectGoogle(): Promise<any> {
    try {
      const res = await fetch("/api/auth/google/disconnect", {
        method: "POST",
        headers: this.authHeaders(true),
        credentials: "same-origin"
      });
      return await readApiJson(res);
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  async getGoogleStatus(): Promise<any> {
    try {
      const res = await fetch("/api/auth/google/status", {
        headers: this.authHeaders(false),
        credentials: "same-origin",
        cache: "no-store"
      });
      return await readApiJson(res);
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  async updateProfileIdentity(data: { email: string; phone: string; firstName: string; lastName: string }): Promise<any> {
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: this.authHeaders(true),
        credentials: "same-origin",
        body: JSON.stringify(data)
      });
      return await readApiJson(res);
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  async changeUsername(username: string): Promise<any> {
    try {
      const res = await fetch("/api/auth/username", {
        method: "PATCH",
        headers: this.authHeaders(true),
        credentials: "same-origin",
        body: JSON.stringify({ username })
      });
      const data = await readApiJson(res);
      if (res.ok && data?.success) {
        memoryCache.clear();
        inFlightRequests.clear();
      }
      return data;
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  async resolveUsername(username: string): Promise<any | null> {
    try {
      const res = await fetch(`/api/users/resolve/${encodeURIComponent(username)}`, {
        credentials: "same-origin",
        cache: "no-cache"
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  },

  // ✅ NEW: Verify 2FA OTP during login
  async verify2FA(otpSessionToken: string, otp: string): Promise<any> {
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otpSessionToken, otp })
      });
      const data = await readApiJson(res);
      if (data?.success && data?.csrfToken) this.setToken(data.csrfToken, true);
      return data;
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  async requestPasswordReset(email: string): Promise<any> {
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email })
      });
      return await readApiJson(res);
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  async confirmPasswordReset(email: string, code: string, newPassword: string): Promise<any> {
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, code, newPassword })
      });
      return await readApiJson(res);
    } catch (err: any) {
      return { success: false, error: friendlyNetworkError(err) };
    }
  },

  async verifyEmail(token: string, code: string): Promise<any> {
    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ code })
    });
    return await res.json();
  },

  async resendVerification(token: string): Promise<any> {
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return await res.json();
  },

  async getSessions(token: string): Promise<any> {
    try {
      const res = await fetch("/api/auth/sessions", {
        headers: { "X-CSRF-Token": token }
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.success && data?.csrfToken) this.setToken(data.csrfToken, true);
        return data;
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  },

  async deleteSession(token: string, sessionId: string): Promise<any> {
    try {
      const res = await fetch(`/api/auth/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": token }
      });
      if (res.ok) return await res.json();
      return { success: false };
    } catch {
      return { success: false };
    }
  },

  async changePassword(token: string, currentPassword: string, newPassword: string): Promise<any> {
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-CSRF-Token": token 
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (res.ok) return await res.json();
      return { success: false, error: "خطای شبکه" };
    } catch {
      return { success: false, error: "خطای شبکه" };
    }
  },

  async deleteAccount(token: string, confirmation: string, password: string): Promise<any> {
    try {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token
        },
        credentials: "same-origin",
        body: JSON.stringify({ confirmation, password })
      });
      const data = await readApiJson(res);
      return res.ok ? data : { success: false, error: data?.error || "حذف حساب کاربری ناموفق بود.", code: data?.code };
    } catch (error) {
      return { success: false, error: friendlyNetworkError(error) };
    }
  },

  async getMe(token?: string | null): Promise<any> {
    // The sessionId cookie is HTTP-only, so session restoration must not depend
    // on JavaScript being able to read the separate CSRF cookie. GET /auth/me
    // refreshes that CSRF cookie after validating the durable server session.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const headers: Record<string, string> = {};
        if (token) headers["X-CSRF-Token"] = token;
        const res = await fetch("/api/auth/me", {
          headers,
          credentials: "same-origin",
          cache: "no-store"
        });
        if (res.ok) return await res.json();
        if (res.status === 401 || res.status === 403) {
          return { success: false, unauthorized: true, status: res.status };
        }
        if (attempt === 2) return { success: false, unavailable: true, status: res.status };
      } catch {
        if (attempt === 2) return { success: false, unavailable: true };
      }
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
    return { success: false, unavailable: true };
  },

  async getNotifications(token?: string | null): Promise<any[]> {
    const headers: Record<string, string> = {};
    if (token) headers["X-CSRF-Token"] = token;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch("/api/notifications", {
          headers,
          credentials: "same-origin",
          cache: "no-store"
        });
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
        continue;
      }

      if (res.ok) {
        const items = await res.json();
        return dedupeAchievementNotifications((Array.isArray(items) ? items : []).map((n: any) => ({
          id: n.id,
          title: n.title,
          text: n.text || n.message || "",
          time: n.time || "همین حالا",
          type: n.type || "system",
          link: n.link || "",
          createdAt: n.created_at || "",
          read: n.is_read === 1 || n.is_read === true
        })));
      }

      const transientGatewayFailure = [502, 503, 504].includes(res.status);
      if (!transientGatewayFailure || attempt === 2) {
        throw new Error(`به‌روزرسانی اعلان‌ها با HTTP ${res.status} ناموفق بود`);
      }
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
    return [];
  },

  async updateStats(token: string, stats: { level: number; xp: number; coins?: number; streak?: number }): Promise<void> {
    await fetch("/api/auth/update-stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify(stats)
    });
  },

  async syncReadingProgress(token: string, progress: { novelId: string; novelTitle: string; chapterId?: string; chapterNumber: number; scrollPercentage: number; readSeconds?: number; source?: string }, options?: { keepalive?: boolean }): Promise<void> {
    await fetch("/api/auth/reading-progress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      keepalive: options?.keepalive === true,
      body: JSON.stringify(progress)
    });
  },

  async getReadingProgress(token: string): Promise<ReadingProgress[]> {
    const response = await fetch("/api/auth/reading-progress", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Reading progress refresh failed");
    const body = await response.json();
    return Array.isArray(body?.readingProgress) ? body.readingProgress : [];
  },

  async toggleBookmark(token: string, novelId: string, bookmark: boolean, shelfStatus = "plan_to_read"): Promise<string[] | null> {
    const res = await fetch("/api/auth/bookmarks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ novelId, bookmark, shelfStatus })
    });
    if (res.ok) {
      const body = await res.json();
      invalidateMemoryCache("recommend:");
      return body.bookmarkedIds;
    }
    return null;
  },

  async getLibrary(token: string): Promise<any[]> {
    const res = await fetch("/api/auth/library", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (res.ok) {
      const data = await res.json();
      invalidateMemoryCache("recommend:");
      return data.items || [];
    }
    return [];
  },

  async updateLibraryItem(token: string, novelId: string, payload: { shelfStatus: string; categoryId?: string | null; notes?: string | null; visibility?: "private" | "public" }): Promise<any[]> {
    const res = await fetch(`/api/auth/library/${encodeURIComponent(novelId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      return data.items || [];
    }
    return [];
  },

  async getPublicBookmarks(username: string): Promise<any[]> {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}/bookmarks`, {
      credentials: "same-origin"
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  },

  async getNovelLike(token: string | null, novelId: string): Promise<{ liked: boolean; likesCount: number } | null> {
    return cachedJson(`novel-like:${novelId}:${token ? "auth" : "anon"}`, 30_000, async () => {
      const headers: Record<string, string> = {};
      if (token) headers["X-CSRF-Token"] = token;
      const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/like`, { headers, credentials: "same-origin" });
      if (res.ok) return await res.json();
      return null;
    });
  },

  async toggleNovelLike(token: string, novelId: string, liked: boolean): Promise<{ liked: boolean; likesCount: number } | null> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ liked })
    });
    if (res.ok) {
      const data = await res.json();
      setMemoryCache(`novel-like:${novelId}:auth`, data, 30_000);
      return data;
    }
    return null;
  },

  async getChapterLike(token: string | null, novelId: string, chapterId: string): Promise<{ liked: boolean; likesCount: number; novelLikesCount?: number; unlimited?: boolean; usedToday?: number; dailyLimit?: number | null } | null> {
    const headers: Record<string, string> = {};
    if (token) headers["X-CSRF-Token"] = token;
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/like`, { headers, credentials: "same-origin" });
    return res.ok ? await res.json() : null;
  },

  async toggleChapterLike(token: string, novelId: string, chapterId: string, liked: boolean): Promise<{ success?: boolean; liked?: boolean; likesCount?: number; novelLikesCount?: number; unlimited?: boolean; usedToday?: number; dailyLimit?: number | null; error?: string }> {
    const res = await fetch(`/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ liked })
    });
    const data = await res.json().catch(() => ({}));
      return res.ok ? data : { ...data, success: false, error: data.error || "به‌روزرسانی پسند فصل ناموفق بود." };
  },

  async searchNovels(query: string, filters: Record<string, string> = {}): Promise<any[]> {
    try {
      const token = this.getToken();
      const headers: Record<string, string> = {};
      if (token) {      headers["X-CSRF-Token"] = token;
      }
      const params = new URLSearchParams({ q: query });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const res = await fetch(`/api/novels/search?${params.toString()}`, { headers, credentials: "same-origin" });
      if (res.ok) return await res.json();
    } catch {}
    return [];
  },

  async getBookmarkCategories(token: string): Promise<any[]> {
    const res = await fetch("/api/auth/bookmark-categories", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (res.ok) {
      const data = await res.json();
      return data.categories || [];
    }
    return [];
  },

  async saveBookmarkCategories(token: string, categories: any[]): Promise<boolean> {
    const normalized = (Array.isArray(categories) ? categories : []).map((category: any, index: number) => ({
      id: category?.id || `cat-${index + 1}`,
      name: category?.name || `دسته‌بندی ${index + 1}`,
      items: Array.isArray(category?.items) ? category.items : Array.isArray(category?.ids) ? category.ids : []
    }));
    const res = await fetch("/api/auth/bookmark-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ categories: normalized })
    });
    return res.ok;
  },

  async readNotifications(token: string, id?: string, readAll?: boolean): Promise<void> {
    await fetch("/api/auth/notifications/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ id, readAll })
    });
  },

  async saveNote(token: string, chapterId: string, note: string): Promise<boolean> {
    const res = await fetch(`/api/auth/notes/${chapterId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      body: JSON.stringify({ note })
    });
    return res.ok;
  },

  async getNote(token: string, chapterId: string): Promise<string> {
    const res = await fetch(`/api/auth/notes/${chapterId}`, {
      headers: {
        "X-CSRF-Token": token
      }
    });
    if (res.ok) {
      const data = await res.json();
      return data.note;
    }
    return "";
  },

  async readMessages(token: string, id?: string, readAll?: boolean): Promise<void> {
    await fetch("/api/auth/messages/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ id, readAll })
    });
  },

  async getThreads(): Promise<any[]> {
    const res = await fetch("/api/forums/threads");
    if (res.ok) return await res.json();
    return [];
  },

  async getForumCategories(): Promise<string[]> {
    const res = await fetch("/api/forums/categories");
    if (!res.ok) return [];
    const body = await res.json().catch(() => ({}));
    return Array.isArray(body?.categories) ? body.categories.map((item: any) => String(item?.name || item).trim()).filter(Boolean) : [];
  },

  async createThread(thread: { title: string; author: string; authorRole: string; category: string; content: string }): Promise<{ success: boolean; id?: string; error?: string; thread?: any }> {
    const token = this.getToken();
    const res = await fetch("/api/forums/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
      credentials: "same-origin",
      body: JSON.stringify(thread)
    });
    const body = await res.json().catch(() => ({}));
    return { success: res.ok && body?.success !== false, id: body?.id, error: body?.error, thread: body?.thread };
  },

  async approveThread(id: string): Promise<any> {
    const token = this.getToken();
    const res = await fetch(`/api/forums/threads/${encodeURIComponent(id)}/approve`, {
      method: "PATCH",
      headers: token ? { "X-CSRF-Token": token } : {},
      credentials: "same-origin"
    });
    const data = await readApiJson(res);
    return res.ok ? data : { success: false, status: res.status, error: data?.error || "تأیید تاپیک ناموفق بود." };
  },

  async rejectThread(id: string): Promise<any> {
    const token = this.getToken();
    const res = await fetch(`/api/forums/threads/${encodeURIComponent(id)}/reject`, {
      method: "PATCH",
      headers: token ? { "X-CSRF-Token": token } : {},
      credentials: "same-origin"
    });
    const data = await readApiJson(res);
    return res.ok ? data : { success: false, status: res.status, error: data?.error || "رد تاپیک ناموفق بود." };
  },

  async voteThread(id: string): Promise<boolean> {
    const token = this.getToken();
    const res = await fetch(`/api/forums/threads/${id}/vote`, {
      method: "POST",
      headers: token ? { "X-CSRF-Token": token } : {},
      credentials: "same-origin"
    });
    return res.ok;
  },

  async deleteThread(id: string): Promise<boolean> {
    const token = this.getToken();
    const res = await fetch(`/api/forums/threads/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: token ? { "X-CSRF-Token": token } : {},
      credentials: "same-origin"
    });
    return res.ok;
  },

  async getUsers(token: string): Promise<any[]> {
    const res = await fetch("/api/admin/users", {
      headers: {
        "X-CSRF-Token": token
      },
      credentials: "same-origin"
    });
    if (res.ok) {
      const body = await res.json();
      return Array.isArray(body) ? body : body.users || [];
    }
    const message = await res.text().catch(() => "");
    throw new Error(message || `بارگیری کاربران ناموفق بود (${res.status})`);
  },

  async updateUserDepartments(token: string, userId: string, departments: string[]): Promise<boolean> {
    const res = await fetch(`/api/admin/users/${userId}/departments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      body: JSON.stringify({ departments })
    });
    return res.ok;
  },

  async updateUser(token: string, id: string, data: {role?: string, level?: number, xp?: number, coins?: number, password?: string, stars?: number, premiumDays?: number, premiumLifetime?: boolean, disablePremium?: boolean, is_premium?: boolean, premium_plan?: string, nickname?: string, email?: string, phone?: string, avatar?: string, departments?: string[], verified_author?: boolean, verified_role?: boolean, email_verified?: boolean, profile_bio?: string, custom_role_id?: string | null, is_staff?: boolean, blocked?: boolean, publishing_blocked?: boolean}): Promise<boolean> {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify(data)
    });
    return res.ok;
  },

  async deleteUser(token: string, id: string): Promise<boolean> {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "DELETE",
      headers: {
        "X-CSRF-Token": token
      },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async getAdminSiteAnalytics(token: string): Promise<any | null> {
    const res = await fetch("/api/admin/site-analytics", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok ? await res.json() : null;
  },

  async getAdminNovels(token: string, filters: Record<string, string> = {}): Promise<any[]> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
    const res = await fetch(`/api/admin/novels?${params.toString()}`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.novels || [];
  },

  async deleteAdminNovel(token: string, id: string): Promise<boolean> {
    const res = await fetch(`/api/admin/novels/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async getCustomRoles(token: string): Promise<any[]> {
    const res = await fetch("/api/admin/roles", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.roles || [];
  },

  async saveCustomRole(token: string, payload: { id?: string; name: string; description?: string; permissions: string[] }): Promise<any> {
    const res = await fetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok ? await res.json() : null;
  },

  async updateCustomRole(token: string, id: string, payload: { name: string; description?: string; permissions: string[] }): Promise<any> {
    const res = await fetch(`/api/admin/roles/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok ? await res.json() : await res.json().catch(() => ({ success: false }));
  },

  async deleteCustomRole(token: string, id: string): Promise<any> {
    const res = await fetch(`/api/admin/roles/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok ? await res.json() : await res.json().catch(() => ({ success: false }));
  },

  async updateUserPermissions(token: string, userId: string, payload: { roleId?: string | null; permissions: string[]; isStaff?: boolean }): Promise<boolean> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok;
  },

  async sendAdminEmail(token: string, userId: string, payload: { subject: string; message: string }): Promise<any> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return await res.json();
  },

  async sendAdminNotification(token: string, userId: string, payload: { title: string; message: string; link?: string }): Promise<any> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return await res.json();
  },

  async sendAdminCommunication(token: string, payload: { scope: "all" | "selected"; userIds: string[]; delivery: "notification" | "email" | "both"; title: string; message: string; link?: string }): Promise<any> {
    const res = await fetch("/api/admin/communications/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "ارسال پیام مدیریتی ناموفق بود.");
    return data;
  },

  async assignTicket(token: string, ticketId: string, assignedTo: string | null): Promise<boolean> {
    const res = await fetch(`/api/admin/tickets/${encodeURIComponent(ticketId)}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ assignedTo })
    });
    return res.ok;
  },

  async getAdminOperations(token: string): Promise<any | null> {
    const res = await fetch("/api/admin/operations", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok ? await res.json() : null;
  },

  async getCommentModeration(token: string, params: { status?: string; page?: number; pageSize?: number; search?: string } = {}): Promise<any> {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.page) query.set("page", String(params.page));
    if (params.pageSize) query.set("pageSize", String(params.pageSize));
    if (params.search) query.set("search", params.search);
    const res = await fetch(`/api/admin/comment-moderation?${query.toString()}`, { headers: { "X-CSRF-Token": token }, credentials: "same-origin" });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "بارگذاری مرکز نظارت دیدگاه‌ها ناموفق بود.");
    return data;
  },

  async decideCommentModeration(token: string, id: string, decision: "approve" | "reject"): Promise<any> {
    const res = await fetch(`/api/admin/comment-moderation/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, credentials: "same-origin", body: JSON.stringify({ decision })
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "ثبت تصمیم دیدگاه ناموفق بود.");
    return data;
  },

  async batchCommentModeration(token: string, ids: string[], action: "approve" | "reject" | "ai"): Promise<any> {
    const res = await fetch("/api/admin/comment-moderation/batch", {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, credentials: "same-origin", body: JSON.stringify({ ids, action })
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "پردازش گروهی دیدگاه‌ها ناموفق بود.");
    return data;
  },

  async getCommentModerationSettings(token: string): Promise<any> {
    const res = await fetch("/api/admin/comment-moderation/settings", { headers: { "X-CSRF-Token": token }, credentials: "same-origin" });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "بارگذاری تنظیمات نظارت ناموفق بود.");
    return data;
  },

  async saveCommentModerationSettings(token: string, payload: { mode: "manual" | "automatic" }): Promise<any> {
    const res = await fetch("/api/admin/comment-moderation/settings", {
      method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, credentials: "same-origin", body: JSON.stringify(payload)
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "ذخیره تنظیمات نظارت ناموفق بود.");
    return data;
  },

  async testCommentModeration(token: string, message: string): Promise<any> {
    const res = await fetch("/api/admin/comment-moderation/test", {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, credentials: "same-origin", body: JSON.stringify({ message })
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "آزمایش پیام ناموفق بود.");
    return data;
  },

  async deleteApprovedComment(token: string, id: string): Promise<boolean> {
    const res = await fetch(`/api/admin/comment-moderation/${encodeURIComponent(id)}`, {
      method: "DELETE", headers: { "X-CSRF-Token": token }, credentials: "same-origin"
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "حذف دیدگاه ناموفق بود.");
    return data?.success === true;
  },

  async getUserTimeline(token: string, userId: string): Promise<any[]> {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/timeline`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.timeline || [];
  },

  async scanAdminContent(token: string, targetType: string, targetId: string): Promise<any> {
    const res = await fetch("/api/admin/content/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ targetType, targetId })
    });
    return res.ok ? await res.json() : { success: false };
  },

  async applyContentAction(token: string, payload: { targetType: string; targetId: string; action: string; note?: string }): Promise<boolean> {
    const res = await fetch("/api/admin/content/action", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok;
  },

  async updateTicketPro(token: string, id: string, payload: any): Promise<boolean> {
    const res = await fetch(`/api/admin/tickets/${encodeURIComponent(id)}/pro`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok;
  },

  async addTicketInternalNote(token: string, id: string, note: string): Promise<boolean> {
    const res = await fetch(`/api/admin/tickets/${encodeURIComponent(id)}/internal-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ note })
    });
    return res.ok;
  },

  async saveBackupSchedule(token: string, payload: any): Promise<any> {
    const res = await fetch("/api/admin/backups/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok ? await res.json() : { success: false };
  },

  async restoreBackupUsers(token: string, filename: string): Promise<any> {
    const res = await fetch(`/api/admin/backups/files/${encodeURIComponent(filename)}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ confirm: "RESTORE_USERS" })
    });
    return res.ok ? await res.json() : { success: false };
  },

  async createRoleFromPreset(token: string, presetId: string, name?: string): Promise<any> {
    const res = await fetch("/api/admin/roles/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ presetId, name })
    });
    return res.ok ? await res.json() : { success: false };
  },

  async getNovelsForEditor(token: string): Promise<any[]> {
    const res = await fetch("/api/editor/novels", { headers: { "X-CSRF-Token": token } });
    if (res.ok) return await res.json();
    return [];
  },

  async getEditorStaff(token: string): Promise<any[]> {
    const res = await fetch("/api/editor/staff", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.staff || [];
  },

  async assignEditorTarget(token: string, payload: { targetType: "novel" | "chapter"; novelId: string; chapterId?: string | null; editorId: string; dueAt?: string | null }): Promise<boolean> {
    const res = await fetch("/api/editor/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok;
  },

  async getDetailedChaptersEditor(token: string, novelId: string): Promise<any[]> {
    const res = await fetch(`/api/editor/novels/${novelId}/chapters`, { headers: { "X-CSRF-Token": token } });
    if (res.ok) return await res.json();
    return [];
  },

  async sendEditorMessage(token: string, novelId: string, content: string): Promise<boolean> {
    const res = await fetch(`/api/editor/novels/${novelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({ content })
    });
    return res.ok;
  },

  async getEditorMessages(token: string, novelId: string): Promise<any[]> {
    const res = await fetch(`/api/editor/novels/${novelId}/messages`, { headers: { "X-CSRF-Token": token } });
    if (res.ok) return await res.json();
    return [];
  },

  async authorGetEditorMessages(token: string, novelId: string): Promise<any[]> {
    const res = await fetch(`/api/auth/novels/${novelId}/editor-messages`, { headers: { "X-CSRF-Token": token } });
    if (res.ok) return await res.json();
    return [];
  },

  async authorSendEditorMessage(token: string, novelId: string, content: string): Promise<boolean> {
    const res = await fetch(`/api/auth/novels/${novelId}/editor-messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({ content })
    });
    return res.ok;
  },

  async editorDeleteChapter(token: string, novelId: string, chapterId: string): Promise<boolean> {
    const res = await fetch(`/api/editor/novels/${novelId}/chapters/${chapterId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token }
    });
    return res.ok;
  },

  async editorSaveChapterNote(token: string, novelId: string, chapterId: string, note: string): Promise<boolean> {
    const res = await fetch(`/api/editor/novels/${novelId}/chapters/${chapterId}/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({ note })
    });
    return res.ok;
  },

  async updateEditorChapterStatus(token: string, novelId: string, chapterId: string, status: string, note = "", scheduledAt?: string): Promise<boolean> {
    const res = await fetch(`/api/editor/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ status, note, scheduledAt })
    });
    return res.ok;
  },

  async getEditorReviewTools(token: string, novelId: string, chapterId: string): Promise<any | null> {
    const res = await fetch(`/api/editor/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/review-tools`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok ? await res.json() : null;
  },

  async saveEditorInlineComment(token: string, novelId: string, chapterId: string, payload: any): Promise<any> {
    const res = await fetch(`/api/editor/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/inline-comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok ? await res.json() : { success: false };
  },

  async updateEditorInlineComment(token: string, commentId: string, status: string): Promise<boolean> {
    const res = await fetch(`/api/editor/inline-comments/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ status })
    });
    return res.ok;
  },

  async saveEditorChecklist(token: string, novelId: string, chapterId: string, checklist: any, status = "in_review"): Promise<boolean> {
    const res = await fetch(`/api/editor/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ checklist, status })
    });
    return res.ok;
  },

  async scanEditorChapter(token: string, novelId: string, chapterId: string): Promise<any> {
    const res = await fetch(`/api/editor/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/scan`, {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok ? await res.json() : { success: false };
  },

  async createEditorThread(token: string, novelId: string, payload: any): Promise<any> {
    const res = await fetch(`/api/editor/novels/${encodeURIComponent(novelId)}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return res.ok ? await res.json() : { success: false };
  },

  async getEditorThreadMessages(token: string, threadId: string): Promise<any> {
    const res = await fetch(`/api/editor/threads/${encodeURIComponent(threadId)}/messages`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok ? await res.json() : null;
  },

  async sendEditorThreadMessage(token: string, threadId: string, content: string): Promise<boolean> {
    const res = await fetch(`/api/editor/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ content })
    });
    return res.ok;
  },

  async bulkEditorChapters(token: string, novelId: string, chapterIds: string[], action: string, note = ""): Promise<any> {
    const res = await fetch(`/api/editor/novels/${encodeURIComponent(novelId)}/chapters/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ chapterIds, action, note })
    });
    return res.ok ? await res.json() : { success: false };
  },

  async moderateNovel(token: string, id: string, status: "approved" | "rejected", note: string): Promise<boolean> {
    const res = await fetch(`/api/editor/novels/${id}/moderate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      credentials: "same-origin",
      body: JSON.stringify({ status, note })
    });
    return res.ok;
  },

  async getTickets(token: string, scope: "mine" | "all" = "mine"): Promise<any[]> {
    const res = await fetch(`/api/support/tickets?scope=${encodeURIComponent(scope)}`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "بارگیری تیکت‌ها ناموفق بود.");
    return Array.isArray(data) ? data : (data.tickets || []);
  },

  // ✅ NEW: Support reporter details
  async createTicket(token: string, title: string, content: string, category: string = 'general', reporterDetails?: { name?: string; email?: string; phone?: string; priority?: string }): Promise<any> {
    const res = await fetch("/api/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ 
        title, 
        message: content, 
        category,
        ...(reporterDetails && {
          name: reporterDetails.name,
          email: reporterDetails.email,
          phone: reporterDetails.phone,
          priority: reporterDetails.priority
        })
      }) 
    });
    const data = await readApiJson(res);
    if (!res.ok || !data?.ticketId) {
      throw new Error(data?.error || "ایجاد تیکت ناموفق بود.");
    }
    return data.ticketId;
  },

  async getTicketMessages(token: string, id: string): Promise<any[]> {
    const res = await fetch(`/api/support/tickets/${encodeURIComponent(id)}`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "بارگیری پیام‌های تیکت ناموفق بود.");
    return data.messages || [];
  },

  async sendTicketMessage(token: string, id: string, content: string): Promise<boolean> {
    const res = await fetch(`/api/support/tickets/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ content })
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "ارسال پیام تیکت ناموفق بود.");
    return true;
  },

  // ✅ NEW: AI Settings Management
  async getAISettings(token: string): Promise<any> {
    const res = await fetch("/api/ai/settings", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (res.ok) return await res.json();
    return null;
  },

  async updateAISettings(token: string, settings: any): Promise<any> {
    const res = await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(settings)
    });
    if (res.ok) return await res.json();
    return null;
  },

  async getAIUsageStats(token: string): Promise<any> {
    const res = await fetch("/api/ai/usage-stats", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (res.ok) return await res.json();
    return null;
  },
  
  async updateTicketStatus(token: string, id: string, status: string): Promise<boolean> {
    const res = await fetch(`/api/support/tickets/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ status })
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "به‌روزرسانی وضعیت تیکت ناموفق بود.");
    return true;
  },

  async deleteTicket(token: string, id: string): Promise<boolean> {
    const res = await fetch(`/api/support/tickets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "حذف تیکت ناموفق بود.");
    return true;
  },

  async createAuthorPost(token: string, payload: { title: string, content: string, novel_id?: string }): Promise<any> {
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    if (res.ok) return await res.json();
    return { success: false };
  },

  async getAuthorPosts(token: string, novelId?: string): Promise<any[]> {
    const url = novelId ? `/api/posts?novel_id=${encodeURIComponent(novelId)}` : `/api/posts`;
    return cachedJson(`author-posts:${novelId || "all"}`, 30_000, async () => {
      const headers: Record<string, string> = {};
      if (token) headers["X-CSRF-Token"] = token;
      const res = await fetch(url, {
        headers,
        credentials: "same-origin"
      });
      if (res.ok) {
        const data = await res.json();
        return data.posts || [];
      }
      return [];
    });
  },

  async getNotificationPrefs(token: string): Promise<any> {
    const cacheKey = `notification-prefs:${token ? token.slice(0, 12) : "anon"}`;
    return cachedJson(cacheKey, 60_000, async () => {
      const res = await fetch("/api/auth/notifications-prefs", {
        headers: token ? { "X-CSRF-Token": token } : {},
        credentials: "same-origin"
      });
      return res.ok ? await res.json() : null;
    });
  },

  async updateNotificationPrefs(token: string, prefs: any): Promise<boolean> {
    const res = await fetch("/api/auth/notifications-prefs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      body: JSON.stringify(prefs)
    });
    if (res.ok) {
      setMemoryCache(`notification-prefs:${token ? token.slice(0, 12) : "anon"}`, prefs, 60_000);
      return true;
    }
    return false;
  },

  async getAuthorStats(token: string): Promise<any> {
    return cachedJson(`author-stats:${token ? token.slice(0, 12) : "anon"}`, 30_000, async () => {
      const res = await fetch("/api/analytics/author-stats", {
        headers: { "X-CSRF-Token": token },
        credentials: "same-origin"
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
      return { performance: [], totals: {}, chapterDropoff: [] };
    });
  },

  async getNovelAnalytics(token: string, novelId: string): Promise<any> {
    const res = await fetch(`/api/analytics/novels/${encodeURIComponent(novelId)}`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (res.ok) return await res.json();
    return null;
  },

  async deleteAnalyticsComment(token: string, type: string, id: string): Promise<boolean> {
    const res = await fetch(`/api/analytics/comments/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async replyAnalyticsComment(token: string, type: string, id: string, content: string): Promise<boolean> {
    const res = await fetch(`/api/analytics/comments/${encodeURIComponent(type)}/${encodeURIComponent(id)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ content })
    });
    return res.ok;
  },

  async getReports(token: string, status: string = "all"): Promise<any[]> {
    const res = await fetch(`/api/admin/reports?status=${encodeURIComponent(status)}`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (res.ok) {
      const data = await res.json();
      return data.reports || [];
    }
    return [];
  },

  async getReportDetails(token: string, reportId: string): Promise<any | null> {
    const res = await fetch(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    if (res.ok) return await res.json();
    return null;
  },

  async updateReport(token: string, reportId: string, payload: any): Promise<any> {
    const res = await fetch(`/api/admin/reports/${encodeURIComponent(reportId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await readApiJson(res);
    return res.ok ? data : { success: false, error: data?.error || "به‌روزرسانی گزارش ناموفق بود." };
  },

  async get2FASetup(token: string): Promise<{ secret?: string; otpauth?: string; error?: string } | null> {
    const res = await fetch('/api/auth/2fa/setup', { method: 'POST', headers: { "X-CSRF-Token": token }, credentials: "same-origin" });
    if (res.ok) return await res.json();
    return null;
  },

  async enable2FA(token: string, secret: string, tokenCode: string): Promise<boolean> {
    const res = await fetch('/api/auth/2fa/enable', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, credentials: "same-origin", body: JSON.stringify({ token: tokenCode }) });
    return res.ok;
  },

  async disable2FA(token: string, tokenCode: string): Promise<boolean> {
    const res = await fetch('/api/auth/2fa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, credentials: "same-origin", body: JSON.stringify({ token: tokenCode }) });
    return res.ok;
  },

  async logAnalyticsEvent(token: string | null, novelId: string, actionType: string, extra: Record<string, any> = {}): Promise<any> {
    const res = await fetch("/api/analytics/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-CSRF-Token": token } : {})
      },
      credentials: "same-origin",
      body: JSON.stringify({ novel_id: novelId, action_type: actionType, ...extra })
    }).catch(() => {});
    if (res && res.ok) return await res.json().catch(() => null);
    return null;
  },

  async logReadingSession(payload: { novelId: string; chapterId?: string; chapterNumber?: number; readSeconds?: number; scrollPercentage?: number; source?: string }): Promise<boolean> {
    const token = this.getToken();
    const metrics = normalizeReadingSessionMetrics(payload.readSeconds, payload.scrollPercentage, Number.MAX_SAFE_INTEGER);
    const normalizedPayload = {
      ...payload,
      ...metrics
    };
    const response = await fetch("/api/analytics/read-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-CSRF-Token": token } : {})
      },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(normalizedPayload)
    }).catch(() => null);
    return Boolean(response?.ok);
  },

  async getActiveContest(): Promise<any | null> {
    const res = await fetch("/api/contests/active");
    if (res.ok) {
      const data = await res.json();
      return data.contest || null;
    }
    return null;
  },

  async getAugustViewsEvent(page = 1, pageSize = 20, summary = false): Promise<any> {
    const params = new URLSearchParams({
      page: String(Math.max(1, Math.trunc(page) || 1)),
      pageSize: String(Math.max(1, Math.min(50, Math.trunc(pageSize) || 20))),
    });
    if (summary) params.set("summary", "1");
    const res = await fetch(`/api/events/august-views-2026?${params.toString()}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "بارگیری جدول امتیازهای رویداد ناموفق بود.");
    return data;
  },

  /**
   * Upload an audio clip for a challenge prompt (owner only, server enforced).
   *
   * Returns the stored `/uploads/...` reference the challenge row will keep.
   */
  async uploadChallengeAudio(file: File): Promise<{ url: string; mimetype: string }> {
    const token = this.getToken();
    if (!token) throw new Error("نشست شما منقضی شده است. دوباره وارد شوید.");
    const form = new FormData();
    form.append("audio", file, file.name || "narration.mp3");
    const res = await fetch("/api/files/audio", {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin",
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) throw new Error(data?.error || `بارگذاری فایل صوتی ناموفق بود (${res.status}).`);
    return { url: String(data.url), mimetype: String(data.mimetype || "") };
  },

  async getActiveChallenge(page = 1, pageSize = 10): Promise<any> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const res = await fetch(`/api/challenges/active?${params.toString()}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "بارگذاری چالش روزانه ناموفق بود.");
    return data;
  },

  async submitChallengeEntry(challengeId: string, content: string): Promise<any> {
    const res = await fetch(`/api/challenges/active/${encodeURIComponent(challengeId)}/entries`, {
      method: "POST",
      headers: this.authHeaders(true),
      credentials: "same-origin",
      body: JSON.stringify({ content })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "ثبت مشارکت ناموفق بود.");
    return data;
  },

  async getMyChallengeEntries(): Promise<any[]> {
    const res = await fetch("/api/challenges/mine", { headers: this.authHeaders(), credentials: "same-origin" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.entries || [];
  },

  async getAdminChallenges(token: string): Promise<any> {
    const res = await fetch("/api/challenges/admin/list", { headers: { "X-CSRF-Token": token }, credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "بارگذاری چالش‌ها ناموفق بود.");
    return data;
  },

  async createChallenge(token: string, payload: { title: string; promptText: string; challengeType: "continuation" | "story_naming"; imageUrl?: string; audioUrl?: string }): Promise<any> {
    const res = await fetch("/api/challenges/admin/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "ساخت چالش ناموفق بود.");
    return data;
  },

  async moderateChallengeEntry(token: string, entryId: string, action: "approve" | "reject"): Promise<any> {
    const res = await fetch(`/api/challenges/admin/entries/${encodeURIComponent(entryId)}/moderate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ action })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "بررسی مشارکت ناموفق بود.");
    return data;
  },

  async saveChallengeWinners(token: string, challengeId: string, rankedEntryIds: string[], announce: boolean): Promise<any> {
    const res = await fetch(`/api/challenges/admin/${encodeURIComponent(challengeId)}/winners`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ rankedEntryIds, announce })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "ذخیره یا اعلام برندگان ناموفق بود.");
    return data;
  },

  async deleteChallengeEntry(token: string, entryId: string): Promise<boolean> {
    const res = await fetch(`/api/challenges/admin/entries/${encodeURIComponent(entryId)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async archiveChallenge(token: string, challengeId: string): Promise<boolean> {
    const res = await fetch(`/api/challenges/admin/${encodeURIComponent(challengeId)}/archive`, {
      method: "POST",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async updateChallenge(token: string, challengeId: string, payload: { title?: string; promptText?: string; imageUrl?: string; audioUrl?: string }): Promise<any> {
    const res = await fetch(`/api/challenges/admin/${encodeURIComponent(challengeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "ویرایش چالش ناموفق بود.");
    return data;
  },

  async deleteChallenge(token: string, challengeId: string): Promise<boolean> {
    const res = await fetch(`/api/challenges/admin/${encodeURIComponent(challengeId)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok;
  },

  /**
   * Administrator-managed events.
   *
   * Events are rows now, so the panel can create, edit, feature, retire and
   * delete them (banner included) without a deployment. Validation errors carry
   * the offending `field` so the form can point at it.
   */
  async getAllSiteEvents(token: string): Promise<any[]> {
    const res = await fetch("/api/events/admin/all", {
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "بارگذاری رویدادها ناموفق بود.");
    return Array.isArray(data?.events) ? data.events : [];
  },

  async getFeaturedEventBanner(): Promise<any | null> {
    const res = await fetch("/api/events/featured-banner", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const data = await readApiJson(res);
    return data?.event || null;
  },

  async saveSiteEvent(token: string, payload: any, eventId?: string): Promise<any> {
    const res = await fetch(
      eventId ? `/api/events/admin/${encodeURIComponent(eventId)}` : "/api/events/admin",
      {
        method: eventId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      },
    );
    const data = await readApiJson(res);
    if (!res.ok) {
      const error: any = new Error(data?.error || "ذخیره رویداد ناموفق بود.");
      error.field = data?.field;
      throw error;
    }
    return data?.event;
  },

  async setSiteEventStatus(token: string, eventId: string, status: string, isFeatured?: boolean): Promise<any> {
    const res = await fetch(`/api/events/admin/${encodeURIComponent(eventId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ status, isFeatured }),
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "تغییر وضعیت رویداد ناموفق بود.");
    return data?.event;
  },

  async deleteSiteEvent(token: string, eventId: string): Promise<{ removedViews: number }> {
    const res = await fetch(`/api/events/admin/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin",
    });
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data?.error || "حذف رویداد ناموفق بود.");
    return { removedViews: Number(data?.removedViews || 0) };
  },

  async getEventAdminOverview(token: string): Promise<any> {
    const res = await fetch("/api/events/august-views-2026/admin-overview", { headers: { "X-CSRF-Token": token }, credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "بارگذاری نمای مدیریتی رویداد ناموفق بود.");
    return data;
  },

  async addEventExclusion(token: string, username: string): Promise<any> {
    const res = await fetch("/api/events/august-views-2026/admin/exclusions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ username })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "افزودن استثنا ناموفق بود.");
    return data;
  },

  async removeEventExclusion(token: string, userId: string): Promise<boolean> {
    const res = await fetch(`/api/events/august-views-2026/admin/exclusions/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async clearEventNovelViews(token: string, novelId: string): Promise<any> {
    const res = await fetch(`/api/events/august-views-2026/admin/views/${encodeURIComponent(novelId)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "پاک‌سازی بازدیدها ناموفق بود.");
    return data;
  },

  async getEmailServerStatus(token: string): Promise<any> {
    const res = await fetch("/api/admin/email/status", { headers: { "X-CSRF-Token": token }, credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "بارگذاری وضعیت ایمیل ناموفق بود.");
    return data;
  },

  async saveEmailSmtpConfig(token: string, payload: {
    host?: string; port?: number; secure?: boolean; user?: string; pass?: string;
    from?: string; direct?: boolean; verificationEnabled?: boolean;
  }): Promise<any> {
    const res = await fetch("/api/admin/email/smtp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "ذخیره پیکربندی ایمیل ناموفق بود.");
    return data;
  },

  async sendEmailTest(token: string, to: string): Promise<any> {
    const res = await fetch("/api/admin/email/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify({ to })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "ارسال ایمیل آزمایشی ناموفق بود.");
    return data;
  },

  async toggleEmailInbound(token: string, payload: { enabled: boolean; port: number; domain: string; host?: string }): Promise<any> {
    const res = await fetch("/api/admin/email/inbound/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "تغییر وضعیت دریافت ایمیل ناموفق بود.");
    return data;
  },

  async getInboundEmails(token: string): Promise<any[]> {
    const res = await fetch("/api/admin/email/inbound/messages", { headers: { "X-CSRF-Token": token }, credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) return [];
    return data.messages || [];
  },

  async readInboundEmail(token: string, id: string): Promise<any | null> {
    const res = await fetch(`/api/admin/email/inbound/messages/${encodeURIComponent(id)}`, { headers: { "X-CSRF-Token": token }, credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!res.ok) return null;
    return data.message || null;
  },

  async deleteInboundEmail(token: string, id: string): Promise<boolean> {
    const res = await fetch(`/api/admin/email/inbound/messages/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": token },
      credentials: "same-origin"
    });
    return res.ok;
  },

  async getContestSubmissions(contestId: string): Promise<any[]> {    const res = await fetch(`/api/contests/${encodeURIComponent(contestId)}/submissions`, {
      headers: this.authHeaders(),
      credentials: "same-origin"
    });
    if (res.ok) {
      const data = await res.json();
      return data.submissions || [];
    }
    return [];
  },

  async submitContestEntry(contestId: string, payload: { title: string; synopsis: string; novelId?: string; contentUrl?: string }): Promise<any> {
    const res = await fetch(`/api/contests/${encodeURIComponent(contestId)}/submissions`, {
      method: "POST",
      headers: this.authHeaders(true),
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return await res.json();
  },

  async saveContest(token: string, payload: any): Promise<any> {
    const res = await fetch("/api/contests", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return await res.json();
  },

  async supportAuthor(username: string, payload: { amount: number; message?: string; novelId?: string }): Promise<any> {
    const res = await fetch(`/api/authors/${encodeURIComponent(username)}/support`, {
      method: "POST",
      headers: this.authHeaders(true),
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return await res.json();
  },

  async getAuthorLinks(username: string): Promise<any[]> {
    const res = await fetch(`/api/authors/${encodeURIComponent(username)}/links`, { credentials: "same-origin" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.links) ? data.links : [];
  },

  async createAuthorLink(payload: { platform: string; label: string; url: string }): Promise<any> {
    const res = await fetch("/api/auth/profile/links", {
      method: "POST",
      headers: this.authHeaders(true),
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return readApiJson(res);
  },

  async updateAuthorLink(id: string, payload: { platform: string; label: string; url: string }): Promise<any> {
    const res = await fetch(`/api/auth/profile/links/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: this.authHeaders(true),
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    return readApiJson(res);
  },

  async deleteAuthorLink(id: string): Promise<any> {
    const res = await fetch(`/api/auth/profile/links/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: this.authHeaders(),
      credentials: "same-origin"
    });
    return readApiJson(res);
  },

  async getExchangeReceived(): Promise<any[]> {
    const res = await fetch("/api/exchange/received", {
      headers: this.authHeaders(),
      credentials: "same-origin"
    });
    if (res.ok) {
      const data = await res.json();
      return data.reviews || [];
    }
    return [];
  },

  async getExchangeGiven(): Promise<any[]> {
    const res = await fetch("/api/exchange/given", {
      headers: this.authHeaders(),
      credentials: "same-origin"
    });
    if (res.ok) {
      const data = await res.json();
      return data.reviews || [];
    }
    return [];
  },

  async getExchangeStats(): Promise<any> {
    const res = await fetch("/api/exchange/stats", {
      headers: this.authHeaders(),
      credentials: "same-origin"
    });
    if (res.ok) {
      const data = await res.json();
      return data.stats || null;
    }
    return null;
  },

  async updateBio(bio: string): Promise<any> {
    const token = this.getToken();
    if (!token) return { success: false };
    try {
      const res = await fetch("/api/profile/bio", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        credentials: "same-origin",
        body: JSON.stringify({ bio })
      });
      if (res.ok) return await res.json();
    } catch {}
    return { success: false };
  },

  async getSystemStats(): Promise<{ totalViews: number; totalChapters: number }> {
    const res = await fetch("/api/analytics/system-stats");
    if (res.ok) return await res.json();
    return { totalViews: 0, totalChapters: 0 };
  },

  async getLeaderboard(mode: "rating" | "views"): Promise<Novel[]> {
    const res = await fetch(`/api/analytics/leaderboard?mode=${mode}`);
    if (res.ok) return await res.json();
    return [];
  }
};
