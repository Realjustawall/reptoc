import "dotenv/config";
import pg from "pg";

const BASE = process.env.TEST_BASE_URL || "http://localhost:3001";
const smokeDb = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_CONNECTION_STRING });

class Client {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.token = "";
    this.forwardedFor = `198.18.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 253)}`;
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  storeCookies(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const value of raw) {
      const first = value.split(";")[0];
      const idx = first.indexOf("=");
      if (idx > 0) this.cookies.set(first.slice(0, idx), first.slice(idx + 1));
    }
    const xsrf = this.cookies.get("XSRF-TOKEN");
    if (xsrf) this.token = decodeURIComponent(xsrf);
    const headerToken = res.headers.get("x-csrf-token");
    if (headerToken) this.token = headerToken;
  }

  async request(method, path, { body, auth = false, form } = {}) {
    const headers = {};
    headers["X-Forwarded-For"] = this.forwardedFor;
    if (!form && body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookieHeader()) headers.Cookie = this.cookieHeader();
    if (auth && this.token) {
      headers.Authorization = `Bearer ${this.token}`;
      headers["X-CSRF-Token"] = this.token;
    }
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
      redirect: "manual"
    });
    this.storeCookies(res);
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data, headers: res.headers };
  }
}

const results = [];
function record(name, pass, details = "") {
  const safeDetails = String(details || "").slice(0, 800);
  results.push({ name, pass, details: safeDetails });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${safeDetails ? ` :: ${safeDetails}` : ""}`);
}
function expect(name, condition, details = "") {
  record(name, !!condition, details);
}

async function main() {
  const stamp = Number(process.env.SMOKE_STAMP) || Date.now();
  console.log(`SMOKE_STAMP=${stamp}`);
  const writer = new Client("writer");
  const reader = new Client("reader");
  const password = "Aa1!TestPassword";
  const writerName = `test_writer_${stamp}`;
  const readerName = `test_reader_${stamp}`;

  let r = await writer.request("GET", "/api/health");
  expect("health", r.ok && r.data?.status === "ok", JSON.stringify(r.data));

  r = await writer.request("GET", "/sitemap.xml");
  expect("sitemap/public-no-redirect", r.status === 200 && !r.headers.get("location"), `status=${r.status} location=${r.headers.get("location")}`);
  expect("sitemap/xml-content-type", /^application\/xml\b/i.test(r.headers.get("content-type") || ""), r.headers.get("content-type") || "");
  expect("sitemap/declaration-valid-structure", typeof r.data === "string" && r.data.indexOf('<?xml version="1.0" encoding="UTF-8"?>') === 0 && /<urlset\b[^>]*>[\s\S]*<\/urlset>$/.test(r.data), String(r.data).slice(0, 100));
  r = await writer.request("GET", "/robots.txt");
  expect("robots/sitemap-reference", r.ok && typeof r.data === "string" && /Sitemap: https:\/\/\S+\/sitemap\.xml/.test(r.data), String(r.data));
  r = await writer.request("GET", "/media/reading-music/quiet-rain.wav");
  expect("reading-music/public-audio", r.ok && /^audio\/wav/.test(r.headers.get("content-type") || ""), r.headers.get("content-type") || "");
  const audioRangeResponse = await fetch(`${BASE}/media/reading-music/quiet-rain.wav?v=2`, {
    headers: { Range: "bytes=0-43" },
  });
  const audioHeader = Buffer.from(await audioRangeResponse.arrayBuffer());
  expect(
    "reading-music/range-and-wave-header",
    audioRangeResponse.status === 206 &&
      audioRangeResponse.headers.get("accept-ranges") === "bytes" &&
      /^bytes 0-43\/\d+$/.test(audioRangeResponse.headers.get("content-range") || "") &&
      audioHeader.subarray(0, 4).toString("ascii") === "RIFF" &&
      audioHeader.readUInt32LE(24) === 44_100,
    `status=${audioRangeResponse.status} range=${audioRangeResponse.headers.get("content-range")}`,
  );
  r = await writer.request("GET", "/media/reading-music/not-approved.wav");
  expect("reading-music/invalid-track", r.status === 404, JSON.stringify(r.data));

  r = await writer.request("POST", "/api/auth/register", { body: { username: writerName, password, nickname: "Writer", email: `${writerName}@example.com` } });
  expect("auth/register writer", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await writer.request("GET", "/api/auth/me", { auth: true });
  expect("auth/me writer", r.ok && r.data?.user?.username === writerName, JSON.stringify(r.data?.user));
  const writerUserId = r.data?.user?.id;
  const achievementReceiptState = await smokeDb.query(
    `SELECT
       (SELECT COUNT(*)::int FROM user_achievements WHERE user_id=$1 AND achievement_id='ach_comm_early') AS claims,
       (SELECT COUNT(*)::int FROM notifications WHERE user_id=$1 AND type='achievement' AND title='دستاورد باز شد: حامی اولیه') AS receipts`,
    [writerUserId],
  );
  expect(
    "notifications/achievement-single-receipt",
    achievementReceiptState.rows[0]?.claims === 1 && achievementReceiptState.rows[0]?.receipts === 1,
    JSON.stringify(achievementReceiptState.rows[0]),
  );

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const imageForm = new FormData();
  imageForm.append("file", new Blob([png], { type: "image/png" }), "cover.png");
  imageForm.append("visibility", "public");
  r = await writer.request("POST", "/api/files/upload", { auth: true, form: imageForm });
  expect("images/upload-success", r.status === 201 && r.data?.url?.startsWith("/uploads/"), JSON.stringify(r.data));
  const uploadedImageUrl = r.data?.url;
  if (uploadedImageUrl) {
    const imageResponse = await fetch(`${BASE}${uploadedImageUrl}`, { redirect: "manual" });
    expect("images/retrieval-content-type", imageResponse.status === 200 && /^image\/png\b/.test(imageResponse.headers.get("content-type") || ""), `${imageResponse.status} ${imageResponse.headers.get("content-type")}`);
    expect("images/public-cors", imageResponse.headers.get("access-control-allow-origin") === "*", imageResponse.headers.get("access-control-allow-origin") || "");
  }
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  const gifImageForm = new FormData();
  gifImageForm.append("file", new Blob([gif], { type: "image/gif" }), "picture.gif");
  gifImageForm.append("visibility", "public");
  r = await writer.request("POST", "/api/files/upload", { auth: true, form: gifImageForm });
  expect("images/gif-upload-success", r.status === 201 && /\.webp$/.test(r.data?.url || ""), JSON.stringify(r.data));
  const uploadedGifUrl = r.data?.url;
  if (uploadedGifUrl) {
    const gifResponse = await fetch(`${BASE}${uploadedGifUrl}`, { redirect: "manual" });
    expect("images/gif-safe-reencode-content-type", gifResponse.status === 200 && /^image\/webp\b/.test(gifResponse.headers.get("content-type") || ""), `${gifResponse.status} ${gifResponse.headers.get("content-type")}`);
  }
  const invalidImageForm = new FormData();
  invalidImageForm.append("file", new Blob(["not an image"], { type: "text/plain" }), "bad.txt");
  r = await writer.request("POST", "/api/files/upload", { auth: true, form: invalidImageForm });
  expect("images/invalid-type", r.status === 415 && r.data?.code === "IMAGE_TYPE_UNSUPPORTED", JSON.stringify(r.data));
  const oversizedImageForm = new FormData();
  oversizedImageForm.append("file", new Blob([png, Buffer.alloc(5 * 1024 * 1024)], { type: "image/png" }), "large.png");
  r = await writer.request("POST", "/api/files/upload", { auth: true, form: oversizedImageForm });
  expect("images/oversized", r.status === 413 && /حجم|size/i.test(r.data?.error || ""), JSON.stringify(r.data));
  r = await writer.request("GET", "/uploads/definitely-missing.png");
  expect("images/missing", r.status === 404, JSON.stringify(r.data));

  r = await reader.request("POST", "/api/auth/register", { body: { username: readerName, password, nickname: "Reader", email: `${readerName}@example.com` } });
  expect("auth/register reader", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("POST", "/api/auth/change-password", { auth: true, body: { currentPassword: password, newPassword: "Bb2!ChangedPassword" } });
  expect("auth/change-password", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("POST", "/api/auth/login", { body: { username: readerName, password: "Bb2!ChangedPassword" } });
  expect("auth/login changed password", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("GET", "/api/auth/me", { auth: true });
  const readerUserId = r.data?.user?.id;

  const novelId = `novel-${stamp}`;
  const chapterId = `chapter-${stamp}`;
  const novelPayload = {
    id: novelId,
    title: `Smoke Novel ${stamp}`,
    author: writerName,
    coverUrl: uploadedImageUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400",
    description: "A complete smoke test novel created by the automated endpoint tester.",
    genre: "Action",
    mainCategories: ["Action"],
    subCategories: ["Magic"],
    warnings: [" Dark Themes ", "dark_themes"],
    tags: ["smoke"],
    ageRating: "PG-13",
    chapters: [{
      id: chapterId,
      chapterNumber: 1,
      title: "Smoke Chapter",
      content: "<p>This chapter has enough content to pass validation and render in the reader.</p>",
      wordCount: 14,
      status: "Published"
    }]
  };
  r = await writer.request("POST", "/api/novels", { auth: true, body: novelPayload });
  expect("novels/create", r.ok && r.data?.success, JSON.stringify(r.data));
  await smokeDb.query("UPDATE novels SET approval_status='approved' WHERE id=$1", [novelId]);
  r = await writer.request("GET", `/api/novels/${novelId}`, { auth: true });
  expect("warnings/dark-themes-canonical", r.ok && r.data?.warnings?.includes("dark_themes") && r.data?.warnings?.length === 1, JSON.stringify(r.data?.warnings));
  expect("views/average-and-total", r.ok && r.data?.viewsCount === 0 && r.data?.averageViews === 0 && r.data?.publishedChapterCount === 1, JSON.stringify({ views: r.data?.viewsCount, average: r.data?.averageViews, chapters: r.data?.publishedChapterCount }));
  if (uploadedGifUrl) {
    r = await writer.request("PUT", `/api/novels/${novelId}`, { auth: true, body: { coverUrl: uploadedGifUrl } });
    expect("images/existing-novel-cover-only-save", r.ok && r.data?.novel?.cover_url === uploadedGifUrl, JSON.stringify(r.data));
    r = await writer.request("GET", `/api/novels/${novelId}`, { auth: true });
    expect("images/existing-novel-cover-persists", r.ok && r.data?.coverUrl === uploadedGifUrl, JSON.stringify({ coverUrl: r.data?.coverUrl }));
  }

  r = await writer.request("PUT", `/api/novels/${novelId}`, { auth: true, body: { warnings: [" graphic_violence ", "Dark Themes", "Dark Themes"] } });
  expect("warnings/several-trimmed-deduplicated", r.ok, JSON.stringify(r.data));
  r = await writer.request("PUT", `/api/novels/${novelId}`, { auth: true, body: { warnings: ["Unsupported Smoke Warning"] } });
  expect("warnings/unsupported-clear-error", r.status === 422 && r.data?.invalidValue === "Unsupported Smoke Warning" && r.data?.field === "warnings", JSON.stringify(r.data));
  r = await writer.request("PUT", `/api/novels/${novelId}`, { auth: true, body: { title: `${novelPayload.title} Updated` } });
  expect("warnings/unrelated-update-preserves", r.ok, JSON.stringify(r.data));
  r = await writer.request("GET", `/api/novels/${novelId}`, { auth: true });
  expect("warnings/still-present-after-unrelated-update", r.data?.warnings?.includes("graphic_violence") && r.data?.warnings?.includes("dark_themes"), JSON.stringify(r.data?.warnings));

  r = await writer.request("PUT", `/api/novels/${novelId}`, { auth: true, body: { premiumPresentation: { enabled: true, templateId: "neon" } } });
  expect("premium/non-entitled-rejected", r.status === 403 && r.data?.code === "WRITER_PREMIUM_REQUIRED", JSON.stringify(r.data));
  await smokeDb.query(
    `INSERT INTO user_premium_entitlements(id,user_id,premium_type,status,source,starts_at,is_permanent,is_paused,auto_renew,granted_at,updated_at)
     VALUES($1,$2,'writer','active','paid_subscription',NOW(),true,false,false,NOW(),NOW())`,
    [`smoke-premium-${stamp}`, writerUserId || (await writer.request("GET", "/api/auth/me", { auth: true })).data?.user?.id],
  );
  await smokeDb.query(
    `INSERT INTO premium_entitlement_cache_versions(user_id,version) VALUES($1,2)
     ON CONFLICT(user_id) DO UPDATE SET version=premium_entitlement_cache_versions.version+1,updated_at=NOW()`,
    [writerUserId],
  );
  r = await writer.request("PUT", `/api/novels/${novelId}`, { auth: true, body: { premiumPresentation: { enabled: true, templateId: "neon" } } });
  expect("premium/entitled-save", r.ok, JSON.stringify(r.data));
  r = await reader.request("GET", `/api/novels/${novelId}`);
  expect("premium/public-presentation-active", r.ok && r.data?.premiumPresentationActive === true && r.data?.premiumPresentation?.templateId === "neon", JSON.stringify(r.data?.premiumPresentation));

  r = await writer.request("POST", `/api/novels/${novelId}/chapters`, { auth: true, body: { id: chapterId, chapterNumber: 1, title: "Smoke Chapter Updated", content: "<p>Updated chapter content for version history validation.</p>", status: "Published" } });
  expect("chapters/update", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await writer.request("GET", `/api/novels/${novelId}/chapters/${chapterId}/versions`, { auth: true });
  expect("chapter versions/list", r.ok && Array.isArray(r.data?.versions), JSON.stringify(r.data));
  const versionId = r.data?.versions?.[0]?.id;
  if (versionId) {
    r = await writer.request("POST", `/api/novels/${novelId}/chapters/${chapterId}/restore`, { auth: true, body: { versionId } });
    expect("chapter versions/restore", r.ok && r.data?.success, JSON.stringify(r.data));
  } else {
    record("chapter versions/restore", false, "No version row created");
  }

  const additionalChapterIds = [`chapter-${stamp}-2`, `chapter-${stamp}-3`];
  for (const [index, additionalChapterId] of additionalChapterIds.entries()) {
    r = await writer.request("POST", `/api/novels/${novelId}/chapters`, {
      auth: true,
      body: {
        id: additionalChapterId,
        chapterNumber: index + 2,
        title: `Like Test Chapter ${index + 2}`,
        content: `<p>Independent chapter like test ${index + 2}.</p>`,
        status: "Published",
      },
    });
    expect(`chapter likes/setup chapter ${index + 2}`, r.ok && r.data?.chapter?.id === additionalChapterId, JSON.stringify(r.data));
  }

  const likedChapterIds = [chapterId, ...additionalChapterIds];
  for (const likedChapterId of likedChapterIds) {
    r = await reader.request("POST", `/api/novels/${novelId}/chapters/${likedChapterId}/like`, { auth: true, body: { liked: true } });
    expect(`chapter likes/several/${likedChapterId}`, r.ok && r.data?.liked === true && r.data?.unlimited === true, JSON.stringify(r.data));
  }
  let chapterLikeRows = await smokeDb.query(
    "SELECT chapter_id,COUNT(*)::int AS count FROM chapter_likes WHERE user_id=$1 AND chapter_id=ANY($2::text[]) GROUP BY chapter_id ORDER BY chapter_id",
    [readerUserId, likedChapterIds],
  );
  expect(
    "chapter likes/unlimited distinct chapters",
    chapterLikeRows.rows.length === 3 && chapterLikeRows.rows.every((row) => row.count === 1),
    JSON.stringify(chapterLikeRows.rows),
  );

  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${chapterId}/like`, { auth: true, body: { liked: true } });
  chapterLikeRows = await smokeDb.query(
    "SELECT COUNT(*)::int AS count FROM chapter_likes WHERE user_id=$1 AND chapter_id=$2",
    [readerUserId, chapterId],
  );
  expect("chapter likes/duplicate idempotent", r.ok && r.data?.liked === true && chapterLikeRows.rows[0]?.count === 1, JSON.stringify({ response: r.data, rows: chapterLikeRows.rows }));

  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${additionalChapterIds[0]}/like`, { auth: true, body: { liked: false } });
  expect("chapter likes/unlike", r.ok && r.data?.liked === false, JSON.stringify(r.data));
  const simultaneousLikes = await Promise.all([
    reader.request("POST", `/api/novels/${novelId}/chapters/${additionalChapterIds[0]}/like`, { auth: true, body: { liked: true } }),
    reader.request("POST", `/api/novels/${novelId}/chapters/${additionalChapterIds[0]}/like`, { auth: true, body: { liked: true } }),
  ]);
  chapterLikeRows = await smokeDb.query(
    "SELECT COUNT(*)::int AS count FROM chapter_likes WHERE user_id=$1 AND chapter_id=$2",
    [readerUserId, additionalChapterIds[0]],
  );
  expect(
    "chapter likes/concurrent duplicate idempotent",
    simultaneousLikes.every((result) => result.ok && result.data?.liked === true) && chapterLikeRows.rows[0]?.count === 1,
    JSON.stringify({ responses: simultaneousLikes.map((result) => result.data), rows: chapterLikeRows.rows }),
  );

  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${additionalChapterIds[1]}/like`, { auth: true, body: { liked: false } });
  expect("chapter likes/unlike before relike", r.ok && r.data?.liked === false, JSON.stringify(r.data));
  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${additionalChapterIds[1]}/like`, { auth: true, body: { liked: true } });
  expect("chapter likes/re-like", r.ok && r.data?.liked === true, JSON.stringify(r.data));
  r = await reader.request("GET", `/api/novels/${novelId}/chapters/${additionalChapterIds[1]}/like`, { auth: true });
  expect("chapter likes/refresh state", r.ok && r.data?.liked === true && r.data?.likesCount === 1, JSON.stringify(r.data));

  for (const additionalChapterId of additionalChapterIds) {
    r = await writer.request("DELETE", `/api/novels/${novelId}/chapters/${additionalChapterId}`, { auth: true });
    expect(`chapter likes/cleanup ${additionalChapterId}`, r.ok && r.data?.success, JSON.stringify(r.data));
  }

  r = await reader.request("GET", "/api/novels");
  expect("novels/list", r.ok && Array.isArray(r.data), `count=${Array.isArray(r.data) ? r.data.length : "n/a"}`);
  r = await reader.request("GET", `/api/novels/search?q=${encodeURIComponent("Smoke Novel")}`, { auth: true });
  expect("novels/search", r.ok && Array.isArray(r.data), JSON.stringify(r.data?.[0]));

  r = await reader.request("POST", `/api/novels/${novelId}/reviews`, { auth: true, body: { rating: 5, ratingOverall: 5, ratingStyle: 4, ratingStory: 5, ratingGrammar: 4, ratingCharacter: 5, comment: "A detailed smoke review with all breakdown fields." } });
  expect("reviews/breakdown", r.ok && r.data?.success && r.data?.review?.ratingStyle === 4, JSON.stringify(r.data));
  r = await writer.request("GET", "/api/auth/me", { auth: true });
  expect(
    "ranking/author-best-novel",
    r.ok
      && r.data?.user?.ranking_basis === "author"
      && Number(r.data?.user?.ranking_score || 0) > 0
      && /^#\d/.test(String(r.data?.user?.user_ranking || "")),
    JSON.stringify(r.data?.user),
  );
  r = await reader.request("GET", `/api/novels/${novelId}/like`, { auth: true });
  expect("novel like/get", r.ok && typeof r.data?.liked === "boolean", JSON.stringify(r.data));
  r = await reader.request("POST", `/api/novels/${novelId}/like`, { auth: true, body: { liked: true } });
  expect("novel like/toggle", r.ok && r.data?.liked === true, JSON.stringify(r.data));
  r = await reader.request("POST", "/api/auth/bookmarks", { auth: true, body: { novelId, bookmark: true } });
  expect("bookmarks/toggle", r.ok && r.data?.bookmarkedIds?.includes(novelId), JSON.stringify(r.data));
  r = await reader.request("POST", "/api/auth/reading-progress", { auth: true, body: { novelId, novelTitle: novelPayload.title, chapterId, chapterNumber: 1, scrollPercentage: 88, readSeconds: 20, source: "smoke" } });
  expect("reading-progress", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("GET", "/api/auth/me", { auth: true });
  expect(
    "reading-time/scroll-does-not-count",
    r.ok && Number(r.data?.user?.hours_read || 0) === 0 && Number(r.data?.user?.streak || 0) === 0,
    JSON.stringify(r.data?.user),
  );
  r = await reader.request("POST", "/api/analytics/read-session", {
    auth: true,
    body: { novelId, chapterId, chapterNumber: 1, readSeconds: 60, scrollPercentage: 88, source: "chapter-reader" },
  });
  expect("reading-time/foreground-session", r.ok && r.data?.success, JSON.stringify(r.data));
  const verifiedReadingRows = await smokeDb.query(
    "SELECT read_seconds,foreground_active FROM reading_sessions WHERE user_id=$1 AND novel_id=$2 AND foreground_active=true ORDER BY created_at DESC LIMIT 1",
    [readerUserId, novelId],
  );
  expect(
    "reading-time/verified-row",
    Number(verifiedReadingRows.rows[0]?.read_seconds || 0) === 60 && verifiedReadingRows.rows[0]?.foreground_active === true,
    JSON.stringify(verifiedReadingRows.rows),
  );
  r = await reader.request("GET", "/api/auth/me", { auth: true });
  expect(
    "reading-time/profile-hours-streak-and-rank",
    r.ok
      && Number(r.data?.user?.hours_read || 0) === 0.02
      && Number(r.data?.user?.streak || 0) === 1
      && r.data?.user?.ranking_basis === "reader"
      && /^#\d/.test(String(r.data?.user?.user_ranking || "")),
    JSON.stringify(r.data?.user),
  );
  r = await reader.request("POST", `/api/auth/notes/${chapterId}`, { auth: true, body: { note: "private reader note" } });
  expect("reader notes/save", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("GET", `/api/auth/notes/${chapterId}`, { auth: true });
  expect("reader notes/get", r.ok && r.data?.note === "private reader note", JSON.stringify(r.data));

  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${chapterId}/comments`, { auth: true, body: { content: "chapter smoke comment" } });
  const chapterCommentId = r.data?.id;
  expect("chapter comments/create", r.ok && r.data?.success && typeof chapterCommentId === "string" && ["pending", "visible", "rejected"].includes(r.data?.moderationStatus), JSON.stringify(r.data));
  if (r.data?.moderationStatus !== "visible" && chapterCommentId) {
    await smokeDb.query("UPDATE chapter_comments SET moderation_status='visible' WHERE id=$1", [chapterCommentId]);
  }
  r = await reader.request("GET", `/api/novels/${novelId}/chapters/${chapterId}/comments`);
  expect("chapter comments/list", r.ok && r.data?.comments?.some((comment) => comment.id === chapterCommentId), JSON.stringify(r.data));

  r = await reader.request("GET", `/api/novels/${novelId}`);
  const paragraphId = r.data?.chapters?.find((chapter) => chapter.id === chapterId)?.paragraphs?.[0]?.id;
  const originalParagraphContent = r.data?.chapters?.find((chapter) => chapter.id === chapterId)?.content;
  expect("paragraphs/stable-id-backfill", r.ok && typeof paragraphId === "string", JSON.stringify(r.data?.chapters?.[0]?.paragraphs));
  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${chapterId}/paragraphs/${paragraphId}/comments`, { auth: true, body: { content: "<img src=x onerror=alert(1)> Safe paragraph thought" } });
  const paragraphCommentRow = (await smokeDb.query(
    "SELECT id,content,moderation_status FROM chapter_comments WHERE novel_id=$1 AND chapter_id=$2 AND user_id=$3 AND content LIKE '%Safe paragraph thought%' ORDER BY created_at DESC LIMIT 1",
    [novelId, chapterId, readerUserId],
  )).rows[0];
  const paragraphCommentId = r.data?.comment?.id || paragraphCommentRow?.id;
  expect("paragraph-comments/create-xss-sanitized", r.status === 201 && r.data?.success && /Safe paragraph thought/.test(paragraphCommentRow?.content || "") && !/[<>]/.test(paragraphCommentRow?.content || ""), JSON.stringify({ response: r.data, row: paragraphCommentRow }));
  if (paragraphCommentRow?.moderation_status !== "visible" && paragraphCommentId) {
    await smokeDb.query("UPDATE chapter_comments SET moderation_status='visible' WHERE id=$1", [paragraphCommentId]);
  }
  const paragraphCommentTarget = await smokeDb.query(
    "SELECT novel_id,chapter_id,paragraph_id FROM chapter_comments WHERE id=$1",
    [paragraphCommentId],
  );
  expect(
    "paragraph-comments/correct-target",
    paragraphCommentTarget.rows[0]?.novel_id === novelId &&
      paragraphCommentTarget.rows[0]?.chapter_id === chapterId &&
      paragraphCommentTarget.rows[0]?.paragraph_id === paragraphId,
    JSON.stringify(paragraphCommentTarget.rows[0]),
  );
  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${chapterId}/paragraphs/${paragraphId}/comments`, { auth: true, body: { content: "A reply in the same paragraph.", parentId: paragraphCommentId } });
  const paragraphReplyRow = (await smokeDb.query(
    "SELECT id,parent_id,moderation_status FROM chapter_comments WHERE novel_id=$1 AND chapter_id=$2 AND user_id=$3 AND content='A reply in the same paragraph.' ORDER BY created_at DESC LIMIT 1",
    [novelId, chapterId, readerUserId],
  )).rows[0];
  expect("paragraph-comments/reply", r.status === 201 && r.data?.success && paragraphReplyRow?.parent_id === paragraphCommentId, JSON.stringify({ response: r.data, row: paragraphReplyRow }));
  if (paragraphReplyRow?.moderation_status !== "visible") {
    await smokeDb.query("UPDATE chapter_comments SET moderation_status='visible' WHERE id=$1", [paragraphReplyRow.id]);
  }
  r = await reader.request("GET", `/api/novels/${novelId}/chapters/${chapterId}/paragraphs/${paragraphId}/comments?limit=1`);
  expect("paragraph-comments/pagination-isolation", r.ok && r.data?.comments?.length === 1 && r.data?.nextCursor, JSON.stringify(r.data));
  r = await reader.request("GET", `/api/novels/${novelId}/chapters/${chapterId}/paragraph-comments/counts`);
  expect("paragraph-comments/count", r.ok && r.data?.counts?.[paragraphId] === 2, JSON.stringify(r.data));
  r = await reader.request("PATCH", `/api/novels/${novelId}/chapters/${chapterId}/comments/${paragraphCommentId}`, { auth: true, body: { content: "Edited paragraph thought." } });
  expect("paragraph-comments/edit-own", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("DELETE", `/api/novels/${novelId}/chapters/${chapterId}/comments/${paragraphCommentId}`, { auth: true });
  expect("paragraph-comments/delete-own", r.ok && r.data?.success, JSON.stringify(r.data));
  const anonymous = new Client("anonymous");
  r = await anonymous.request("POST", `/api/novels/${novelId}/chapters/${chapterId}/paragraphs/${paragraphId}/comments`, { body: { content: "No session" } });
  expect("paragraph-comments/unauthorized", r.status === 401, JSON.stringify(r.data));
  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${chapterId}/paragraphs/not-a-paragraph/comments`, { auth: true, body: { content: "Invalid target" } });
  expect("paragraph-comments/invalid-id", r.status === 422, JSON.stringify(r.data));

  const insertedContent = `<p>A newly inserted paragraph.</p>${originalParagraphContent}`;
  r = await writer.request("POST", `/api/novels/${novelId}/chapters`, { auth: true, body: { id: chapterId, chapterNumber: 1, title: "Smoke Chapter Updated", content: insertedContent, status: "Published" } });
  expect("paragraphs/chapter-edit-with-insertion", r.ok, JSON.stringify(r.data));
  r = await reader.request("GET", `/api/novels/${novelId}`);
  const stableParagraph = r.data?.chapters?.find((chapter) => chapter.id === chapterId)?.paragraphs?.find((paragraph) => paragraph.id === paragraphId);
  expect("paragraphs/association-survives-edit", stableParagraph?.ordinal === 1, JSON.stringify(r.data?.chapters?.[0]?.paragraphs));
  r = await reader.request("GET", `/api/novels/${novelId}/chapters/${chapterId}/paragraphs/${paragraphId}/comments`);
  expect("paragraph-comments/still-associated", r.ok && r.data?.comments?.some((comment) => comment.parent_id === paragraphCommentId), JSON.stringify(r.data));

  r = await writer.request("POST", `/api/novels/${novelId}/chapters`, { auth: true, body: { id: chapterId, chapterNumber: 1, title: "Smoke Chapter Updated", content: "<p>A newly inserted paragraph.</p>", status: "Published" } });
  expect("paragraphs/remove-commented-paragraph", r.ok, JSON.stringify(r.data));
  const remainingParagraphId = r.data?.chapter?.paragraphs?.[0]?.id;
  r = await reader.request("POST", `/api/novels/${novelId}/chapters/${chapterId}/paragraphs/${paragraphId}/comments`, { auth: true, body: { content: "Should fail" } });
  expect("paragraph-comments/deleted-paragraph-rejected", r.status === 422, JSON.stringify(r.data));
  r = await writer.request("POST", `/api/novels/${novelId}/chapters`, { auth: true, body: { id: chapterId, chapterNumber: 1, title: "Smoke Chapter Updated", content: "<p>A newly inserted paragraph.</p>", status: "Draft" } });
  expect("paragraph-comments/chapter-made-private", r.ok, JSON.stringify(r.data));
  r = await reader.request("GET", `/api/novels/${novelId}/chapters/${chapterId}/paragraphs/${remainingParagraphId}/comments`);
  expect("paragraph-comments/chapter-access-restriction", r.status === 404, JSON.stringify(r.data));
  r = await writer.request("POST", `/api/novels/${novelId}/chapters`, { auth: true, body: { id: chapterId, chapterNumber: 1, title: "Smoke Chapter Updated", content: "<p>A newly inserted paragraph.</p>", status: "Published" } });
  expect("paragraph-comments/chapter-restored-public", r.ok, JSON.stringify(r.data));

  r = await reader.request("GET", "/api/social", { auth: true });
  expect("social/list", r.ok && Array.isArray(r.data?.followers), JSON.stringify(r.data));
  r = await reader.request("POST", "/api/social/follow", { auth: true, body: { id: writerUserId, state: true } });
  expect("social/follow", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("POST", `/api/authors/${writerName}/support`, { auth: true, body: { amount: 1, message: "Great work", novelId } });
  expect("author support/stars", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("POST", "/api/social/block", { auth: true, body: { username: writerName, block: true } });
  expect("social/block", r.ok && Array.isArray(r.data?.blockedUsers), JSON.stringify(r.data));
  r = await reader.request("POST", "/api/social/block", { auth: true, body: { username: writerName, block: false } });
  expect("social/unblock", r.ok && Array.isArray(r.data?.blockedUsers), JSON.stringify(r.data));

  r = await reader.request("POST", "/api/auth/messages", { auth: true, body: { to: writerName, subject: "Smoke DM", snippet: "Hello from endpoint test" } });
  expect("messages/send", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await writer.request("POST", "/api/auth/messages/read", { auth: true, body: { readAll: true } });
  expect("messages/read", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await writer.request("POST", "/api/auth/notifications/read", { auth: true, body: { readAll: true } });
  expect("notifications/read", r.ok && r.data?.success, JSON.stringify(r.data));

  r = await reader.request("GET", "/api/achievements", { auth: true });
  expect("achievements/list", r.ok && Array.isArray(r.data), `count=${Array.isArray(r.data) ? r.data.length : "n/a"}`);
  const achId = Array.isArray(r.data) ? r.data[0]?.id : null;
  if (achId) {
    r = await reader.request("POST", "/api/achievements/claim", { auth: true, body: { id: achId } });
    expect("achievements/claim", r.ok || r.status === 400 || r.status === 403, JSON.stringify(r.data));
  }

  r = await reader.request("GET", "/api/auth/bookmark-categories", { auth: true });
  expect("bookmark categories/get", r.ok && Array.isArray(r.data?.categories), JSON.stringify(r.data));
  r = await reader.request("POST", "/api/auth/bookmark-categories", { auth: true, body: { categories: [{ id: "cat-smoke", name: "Smoke", novelIds: [novelId] }] } });
  expect("bookmark categories/save", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("GET", "/api/auth/preferences", { auth: true });
  expect("preferences/get", r.ok && r.data?.preferences, JSON.stringify(r.data));
  r = await reader.request("POST", "/api/auth/preferences", { auth: true, body: { preferences: { subgenres: ["Magic"] } } });
  expect("preferences/save", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("GET", "/api/auth/notifications-prefs", { auth: true });
  expect("notification prefs/get", r.ok, JSON.stringify(r.data));
  r = await reader.request("POST", "/api/auth/notifications-prefs", { auth: true, body: { notify_comments: true, notify_followers: true, notify_likes: true, notify_bookmarks: true } });
  expect("notification prefs/save", r.ok && r.data?.success, JSON.stringify(r.data));

  r = await reader.request("POST", "/api/support/tickets", { auth: true, body: { title: "Smoke Ticket", message: "Testing support ticket", category: "technical" } });
  expect("support ticket/create", r.ok && r.data?.ticketId, JSON.stringify(r.data));
  const ticketId = r.data?.ticketId;
  r = await reader.request("GET", "/api/support/tickets", { auth: true });
  expect("support tickets/list", r.ok && Array.isArray(r.data), JSON.stringify(r.data?.[0]));
  if (ticketId) {
    r = await reader.request("GET", `/api/support/tickets/${ticketId}`, { auth: true });
    expect("support ticket/get", r.ok && Array.isArray(r.data?.messages), JSON.stringify(r.data));
    r = await reader.request("POST", `/api/support/tickets/${ticketId}/messages`, { auth: true, body: { content: "Ticket followup smoke" } });
    expect("support ticket/message", r.ok && r.data?.success, JSON.stringify(r.data));
  }

  r = await reader.request("GET", "/api/forums/threads");
  expect("forums threads/list", r.ok && Array.isArray(r.data), `count=${Array.isArray(r.data) ? r.data.length : "n/a"}`);
  r = await reader.request("GET", "/api/forums/categories");
  const forumCategory = (Array.isArray(r.data) ? r.data : r.data?.categories)?.find((category) => category && category !== "همه انجمن‌ها") || "گفت‌وگوی عمومی";
  expect("forums categories/list", r.ok && typeof forumCategory === "string", JSON.stringify(r.data));
  r = await reader.request("POST", "/api/forums/threads", { auth: true, body: { title: `Smoke Thread ${stamp}`, author: readerName, authorRole: "writer", category: forumCategory, content: "Smoke forum thread content." } });
  expect("forums thread/create", r.ok, JSON.stringify(r.data));
  const threadId = r.data?.thread?.id || r.data?.id;
  if (threadId) {
    r = await reader.request("GET", `/api/forums/threads/${threadId}`);
    expect("forums thread/get", r.ok && r.data?.thread, JSON.stringify(r.data));
    r = await reader.request("POST", `/api/forums/threads/${threadId}/vote`, { auth: true });
    expect("forums thread/vote", r.ok, JSON.stringify(r.data));
    r = await reader.request("POST", `/api/forums/threads/${threadId}/posts`, { auth: true, body: { content: "Smoke reply" } });
    expect("forums post/create", r.ok && r.data?.success, JSON.stringify(r.data));
  }

  r = await writer.request("POST", "/api/posts", { auth: true, body: { title: "Smoke Post", content: "Author update from smoke test", novel_id: novelId } });
  expect("author posts/create", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await writer.request("GET", `/api/posts?novel_id=${novelId}`, { auth: true });
  expect("author posts/list", r.ok && Array.isArray(r.data?.posts), JSON.stringify(r.data));
  r = await writer.request("GET", `/api/posts/author/${writerName}`, { auth: true });
  expect("author posts/by author", r.ok && Array.isArray(r.data?.posts), JSON.stringify(r.data));

  r = await writer.request("GET", "/api/analytics/author-stats", { auth: true });
  expect("analytics/author-stats", r.ok && r.data?.performance, JSON.stringify(r.data?.totals));
  r = await reader.request("POST", "/api/analytics/log", { auth: true, body: { novel_id: novelId, action_type: "view" } });
  expect("analytics/log", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await writer.request("GET", `/api/analytics/novels/${novelId}`, { auth: true });
  expect(
    "analytics/per-novel advanced",
    r.ok &&
      r.data?.novel?.id === novelId &&
      r.data?.novel?.publishedChapterCount === 1 &&
      r.data?.novel?.averageViews === r.data?.novel?.views &&
      Array.isArray(r.data?.audience?.countries) &&
      Array.isArray(r.data?.audience?.devices) &&
      typeof r.data?.audience?.vpnOrProxy?.percentage === "number",
    JSON.stringify({ totals: r.data?.totals, audience: r.data?.audience, insights: r.data?.insights })
  );
  r = await reader.request("GET", "/api/analytics/system-stats");
  expect("analytics/system-stats", r.ok && typeof r.data?.totalViews === "number", JSON.stringify(r.data));
  r = await reader.request("GET", "/api/analytics/leaderboard?mode=views");
  expect("analytics/leaderboard", r.ok && Array.isArray(r.data), JSON.stringify(r.data?.[0]));
  r = await reader.request("GET", `/api/analytics/comments`, { auth: true });
  expect("analytics/comments", r.ok && Array.isArray(r.data?.comments), JSON.stringify(r.data));

  r = await reader.request("GET", `/api/suggestion/recommend?userId=${encodeURIComponent(readerName)}&device=desktop`);
  expect("suggestion/recommend", r.ok && Array.isArray(r.data), JSON.stringify(r.data?.[0]));
  r = await reader.request("POST", "/api/suggestion/event", { auth: true, body: { userId: readerName, novelId, event: "click", readTime: 5, chapter: 1 } });
  expect("suggestion/event", r.ok, JSON.stringify(r.data));

  r = await reader.request("GET", "/api/ads");
  expect("ads/removed", r.status === 404, JSON.stringify(r.data));
  r = await reader.request("GET", "/api/contests/active", { auth: true });
  expect("contests/active", r.ok, JSON.stringify(r.data));

  r = await reader.request("POST", "/api/reports", { auth: true, body: { targetType: "novel", targetId: novelId, reason: "smoke", details: "Smoke report test" } });
  expect("reports/create", r.ok && r.data?.success, JSON.stringify(r.data));

  r = await reader.request("POST", "/api/profile/bio", { auth: true, body: { bio: "Smoke bio" } });
  expect("profile/bio", r.ok && r.data?.success && r.data?.bio === "Smoke bio", JSON.stringify(r.data));
  r = await reader.request("GET", "/api/auth/me", { auth: true });
  expect("profile/bio auth/me sync", r.ok && r.data?.user?.profile_bio === "Smoke bio", JSON.stringify(r.data?.user));
  r = await reader.request("GET", `/api/forums/user/${readerName}/verified`);
  expect("public verified profile", r.ok && r.data?.bio === "Smoke bio", JSON.stringify(r.data));

  r = await reader.request("GET", "/api/auth/sessions", { auth: true });
  expect("sessions/list", r.ok && Array.isArray(r.data?.sessions), JSON.stringify(r.data));

  r = await reader.request("DELETE", "/api/auth/account", { auth: true, body: { confirmation: "delete", password: "Bb2!ChangedPassword" } });
  expect("account-delete/incorrect-confirmation", r.status === 422 && r.data?.code === "CONFIRMATION_MISMATCH", JSON.stringify(r.data));
  r = await reader.request("DELETE", "/api/auth/account", { auth: true, body: { confirmation: "DELETE", password: "wrong password" } });
  expect("account-delete/reauth-failure", r.status === 401 && r.data?.code === "REAUTHENTICATION_FAILED", JSON.stringify(r.data));
  r = await reader.request("DELETE", "/api/auth/account", { auth: true, body: { confirmation: "DELETE", password: "Bb2!ChangedPassword" } });
  expect("account-delete/reader-with-comments", r.ok && r.data?.success, JSON.stringify(r.data));
  r = await reader.request("GET", "/api/auth/me");
  expect("account-delete/session-invalidated", r.status === 401, JSON.stringify(r.data));
  r = await reader.request("DELETE", "/api/auth/account", { auth: true, body: { confirmation: "DELETE", password: "Bb2!ChangedPassword" } });
  expect("account-delete/repeated-request", r.status === 401, JSON.stringify(r.data));

  if (!process.env.STRIPE_SECRET_KEY) {
    await smokeDb.query(
      "UPDATE user_premium_entitlements SET auto_renew=true,payment_subscription_id='sub_smoketest' WHERE user_id=$1",
      [writerUserId],
    );
    r = await writer.request("DELETE", "/api/auth/account", { auth: true, body: { confirmation: "DELETE", password } });
    expect("account-delete/active-renewing-subscription-guard", r.status === 409 && r.data?.code === "SUBSCRIPTION_CANCELLATION_UNAVAILABLE", JSON.stringify(r.data));
    await smokeDb.query(
      "UPDATE user_premium_entitlements SET auto_renew=false,payment_subscription_id=NULL WHERE user_id=$1",
      [writerUserId],
    );
  }
  r = await writer.request("DELETE", "/api/auth/account", { auth: true, body: { confirmation: "DELETE", password } });
  expect("account-delete/author-with-active-premium-novels-chapters", r.ok && r.data?.success, JSON.stringify(r.data));
  const deletedState = await smokeDb.query("SELECT (SELECT COUNT(*)::int FROM users WHERE id=ANY($1::text[])) AS users,(SELECT COUNT(*)::int FROM novels WHERE id=$2) AS novels,(SELECT COUNT(*)::int FROM chapters WHERE id=$3) AS chapters", [[writerUserId, readerUserId], novelId, chapterId]);
  expect("account-delete/dependent-records-removed", deletedState.rows[0]?.users === 0 && deletedState.rows[0]?.novels === 0 && deletedState.rows[0]?.chapters === 0, JSON.stringify(deletedState.rows[0]));
  for (const uploadedUrl of [uploadedImageUrl, uploadedGifUrl].filter(Boolean)) {
    const deletedUploadResponse = await fetch(`${BASE}${uploadedUrl}`, { redirect: "manual" });
    expect(`account-delete/upload-removed:${uploadedUrl}`, deletedUploadResponse.status === 404, `status=${deletedUploadResponse.status}`);
  }

  const failed = results.filter((x) => !x.pass);
  console.log(`\nRESULT ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("FAILED TESTS:");
    failed.forEach((x) => console.log(`- ${x.name}: ${x.details}`));
    await smokeDb.query("DELETE FROM users WHERE id=ANY($1::text[])", [[writerUserId, readerUserId].filter(Boolean)]).catch(() => {});
    await smokeDb.end();
    process.exit(1);
  }
  await smokeDb.end();
}

main().catch((err) => {
  console.error(err);
  smokeDb.end().catch(() => {});
  process.exit(1);
});
