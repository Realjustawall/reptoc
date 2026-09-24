import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import apiRouter from "./server/api/index.js";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { supabase } from "./server/postgres.js";
import bcrypt from "bcryptjs";
import fs from "fs";
import crypto from "crypto";
import { seedAchievements } from "./server/utils/achievements.js";
import { checkAndAwardAchievement } from "./server/utils/achievements.js";
import { getActiveUser } from "./server/utils/auth.js";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { decrypt } from "./server/utils/encryption.js";
import { isChapterVisibleToUser, publishDueScheduledChapters } from "./server/utils/chapters.js";
import { scrubBannedTaxonomyFromDatabase } from "./server/utils/taxonomyCleanup.js";
import { startDiscordBotPresence } from "./server/utils/discord.js";
import { applyPremiumAction } from "./server/utils/premiumEntitlements.js";
import { buildSitemapDocument, canonicalSitemapOrigin, sitemapUrl } from "./server/utils/sitemap.js";
import { getReadingMusicTrack } from "./server/utils/readingMusic.js";
import { isUsernameUnavailable, resolveUsername, validateUsername } from "./server/utils/usernames.js";
import { buildApplicationContentSecurityPolicy, quotedScriptHash } from "./server/security/contentSecurityPolicy.js";
import { canonicalWwwRedirect } from "./server/utils/canonicalOrigin.js";
import { notificationBus } from "./server/utils/notificationBus.js";
import { hashSessionToken } from "./server/utils/auth.js";
import { autoStartInboundMailIfConfigured } from "./server/utils/inboundMail.js";
import { GOOGLE_ANALYTICS_INLINE_SCRIPT } from "./shared/analytics.js";

// PM2/systemd are free to start the bundle with a different working directory.
// Resolve deploy assets from the entry file so direct SPA routes never depend
// on `process.cwd()`.
const serverEntryDirectory = path.dirname(path.resolve(process.argv[1] || process.cwd()));
const bundledDirectory = typeof __dirname === "string" ? __dirname : "";
const applicationRootCandidates = [
  process.env.REPTOC_ROOT,
  process.cwd(),
  bundledDirectory && (path.basename(bundledDirectory) === "build" ? path.dirname(bundledDirectory) : bundledDirectory),
  path.basename(serverEntryDirectory) === "build" ? path.dirname(serverEntryDirectory) : serverEntryDirectory,
].filter((candidate): candidate is string => Boolean(candidate));
const applicationRoot = applicationRootCandidates.find((candidate) => fs.existsSync(path.join(candidate, "package.json")))
  || process.cwd();

/**
 * sha256 hashes of every inline (src-less) script inside the built HTML shell.
 *
 * The production CSP authorizes inline code by hash, so these must match the
 * shipped `dist/client/index.html` exactly. Reading the file at boot keeps the
 * policy correct after any edit to `index.html`; the shared analytics snippet
 * is the fallback when the build output is not present yet.
 */
function shellInlineScriptHashes(): string[] {
  const inlineScripts = new Set<string>([GOOGLE_ANALYTICS_INLINE_SCRIPT]);
  const shellCandidates = [
    path.resolve(applicationRoot, "dist", "client", "index.html"),
    path.resolve(applicationRoot, "index.html"),
  ];
  for (const candidate of shellCandidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const html = fs.readFileSync(candidate, "utf8");
      for (const match of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        const body = match[1] || "";
        // `application/ld+json` blocks are data, not executable code.
        if (/type\s*=\s*(["'])application\/ld\+json\1/i.test(match[0])) continue;
        if (body.trim()) inlineScripts.add(body);
      }
    } catch (error: any) {
      console.warn("Could not read HTML shell for CSP hashing:", candidate, error?.message || error);
    }
  }
  return [...inlineScripts].map(quotedScriptHash);
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader: string, secret: string) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key, rest.join("=")];
    })
  );
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;
  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const digest = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected));
}

function sendAvatarPlaceholder(res: express.Response) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" rx="36" fill="#0f172a"/><circle cx="100" cy="78" r="34" fill="#475569"/><path d="M43 177c8-36 31-56 57-56s49 20 57 56" fill="#475569"/></svg>`;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.type("image/svg+xml").send(svg);
}

function sendFavicon(res: express.Response) {
  // The brand icon is a PNG now; legacy /favicon.ico and /favicon.svg requests
  // are permanently redirected to the canonical asset.
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.redirect(301, "/logo.png");
}

function escapeHtmlAttribute(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

function plainTextForSeo(value: unknown, maximumLength = 2000) {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function absolutePublicUrl(origin: string, value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return `${origin}/logo.png`;
  try {
    const parsed = new URL(raw, `${origin}/`);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : `${origin}/logo.png`;
  } catch {
    return `${origin}/logo.png`;
  }
}

const STATIC_PAGE_SEO: Record<string, { title: string; description: string; indexable?: boolean }> = {
  "/": {
    title: "رپتوک — خواندن رمان‌های تحت وب اصلی",
    description: "کشف و خواندن رمان‌های تحت وب اصلی، دنبال‌کردن نویسندگان و عضویت در جامعهٔ خوانندگان رپتوک.",
  },
  "/discover": {
    title: "کشف رمان‌ها | رپتوک",
    description: "مرور رمان‌های اصلی بر پایه ژانر، امتیاز، محبوبیت و وضعیت مطالعه در رپتوک.",
  },
  "/eventstatus": {
    title: "رویداد بازدیدهای اوت ۲۰۲۶ | رپتوک",
    description: "پیگیری جدول امتیازهای رویداد بازدیدهای اوت رپتوک و دیدن پرخواننده‌ترین رمان‌های اوت ۲۰۲۶.",
  },
  "/ranking": { title: "رتبه‌بندی | رپتوک", description: "رتبه‌بندی آثار و نویسندگان رپتوک." },
  "/notifications": { title: "اعلان‌ها | رپتوک", description: "اعلان‌های حساب رپتوک شما.", indexable: false },
  "/challenges": { title: "چالش‌ها | رپتوک", description: "چالش‌های داستانی و نتایج آن‌ها در رپتوک." },
  "/offline": { title: "مطالعه آفلاین | رپتوک", description: "فصل‌های دانلودشده را بدون اینترنت مطالعه کنید.", indexable: false },
  "/forums": {
    title: "انجمن خوانندگان و نویسندگان | رپتوک",
    description: "در گفتگوهای رپتوک درباره داستان‌های اصلی، خواندن، نوشتن و رمان‌های تحت وب شرکت کنید.",
  },
  "/premium": { title: "پریمیوم رپتوک", description: "آشنایی با امکانات پریمیوم خوانندگی و نویسندگی رپتوک." },
  "/support": { title: "پشتیبانی | رپتوک", description: "برای حساب، مطالعه، انتشار یا تجربه اجتماعی خود در رپتوک کمک بگیرید." },
  "/about-us": { title: "درباره رپتوک", description: "با رپتوک آشنا شوید؛ جامعه‌ای برای رمان‌های تحت وب اصلی، خوانندگان و نویسندگان." },
  "/contact-us": { title: "تماس با رپتوک", description: "با تیم رپتوک در تماس باشید." },
  "/rules": { title: "قوانین جامعه | رپتوک", description: "قوانین جامعه و نویسندگان رپتوک را بخوانید." },
  "/terms-of-service": { title: "شرایط استفاده از خدمات | رپتوک", description: "شرایط استفاده از خدمات رپتوک را بخوانید." },
  "/privacy-policy": { title: "سیاست حفظ حریم خصوصی | رپتوک", description: "سیاست حفظ حریم خصوصی رپتوک را بخوانید." },
  "/dmca": { title: "سیاست DMCA | رپتوک", description: "سیاست کپی‌رایت و DMCA رپتوک را بخوانید." },
  "/writer": { title: "استودیوی نویسندگی | رپتوک", description: "مدیریت داستان‌ها و فصل‌های خود در رپتوک.", indexable: false },
  "/profile": { title: "پروفایل شما | رپتوک", description: "مدیریت پروفایل خود در رپتوک.", indexable: false },
  "/bookmarks": { title: "کتابخانه شما | رپتوک", description: "مدیریت کتابخانه خصوصی شما در رپتوک.", indexable: false },
  "/editor-panel": { title: "پیشخوان ویراستار | رپتوک", description: "محیط کار تحریریه رپتوک.", indexable: false },
  "/authority-center": { title: "مرکز مدیریت | رپتوک", description: "محیط مدیریت رپتوک.", indexable: false },
  "/admin/advertisements": { title: "مدیریت تبلیغات | رپتوک", description: "محیط مدیریت تبلیغات رپتوک.", indexable: false },
  "/not-found": { title: "صفحه پیدا نشد | رپتوک", description: "صفحه درخواستی رپتوک پیدا نشد.", indexable: false },
};

function normalizedCanonicalPath(pathname: string) {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function genericSeoHead(req: express.Request, options: {
  title: string;
  description: string;
  indexable: boolean;
  type?: string;
  image?: string;
  structuredData?: Record<string, unknown>;
}) {
  const origin = getPublicOrigin(req);
  const pathname = normalizedCanonicalPath(req.path);
  const canonical = `${origin}${pathname === "/" ? "/" : pathname}`;
  const image = absolutePublicUrl(origin, options.image || "/logo.png");
  const structuredData = options.structuredData
    ? `<script type="application/ld+json">${JSON.stringify(options.structuredData).replace(/</g, "\\u003c")}</script>`
    : "";
  return [
    `<title>${escapeHtmlAttribute(options.title)}</title>`,
    `<meta name="description" content="${escapeHtmlAttribute(options.description)}" />`,
    `<meta name="robots" content="${options.indexable ? "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" : "noindex,nofollow"}" />`,
    `<link rel="canonical" href="${escapeHtmlAttribute(canonical)}" />`,
    `<meta property="og:site_name" content="رپتوک" />`,
    `<meta property="og:type" content="${escapeHtmlAttribute(options.type || "website")}" />`,
    `<meta property="og:title" content="${escapeHtmlAttribute(options.title)}" />`,
    `<meta property="og:description" content="${escapeHtmlAttribute(options.description)}" />`,
    `<meta property="og:url" content="${escapeHtmlAttribute(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtmlAttribute(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtmlAttribute(options.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtmlAttribute(options.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtmlAttribute(image)}" />`,
    structuredData,
  ].filter(Boolean).join("\n");
}

function injectSeoHead(html: string, head: string, initialContent = "") {
  const withoutExistingSeo = html
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\s+(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");
  const withHead = withoutExistingSeo.replace("</head>", `${head}\n</head>`);
  if (!initialContent) return withHead;
  // This server-rendered summary gives crawlers and no-JavaScript clients
  // meaningful, URL-specific content. React replaces it when the application
  // starts, so it does not duplicate anything in the interactive page.
  return withHead.replace(
    /<div\s+id=["']root["']\s*>\s*<\/div>/i,
    `<div id="root">${initialContent}</div>`,
  );
}

async function socialPreviewForPath(req: express.Request) {
  const match = req.path.match(/^\/novels\/([^/]+)(?:\/chapters\/([^/]+))?\/?$/);
  if (!match) return null;
  const novelId = decodeURIComponent(match[1]);
  const chapterId = match[2] ? decodeURIComponent(match[2]) : null;
  const { data: novel } = await supabase.from("novels")
    .select("id, title, author, description, cover_url, approval_status")
    .eq("id", novelId).eq("approval_status", "approved").single();
  if (!novel) return null;

  let chapterTitle = "";
  let chapterExcerpt = "";
  if (chapterId) {
    const { data: chapter } = await supabase.from("chapters").select("id, title, content, status, scheduled_at").eq("id", chapterId).eq("novel_id", novelId).single();
    if (!chapter || String(chapter.status || "").toLowerCase() !== "published" || (chapter.scheduled_at && new Date(chapter.scheduled_at).getTime() > Date.now())) return null;
    chapterTitle = String(chapter.title || "").trim();
    chapterExcerpt = plainTextForSeo(chapter.content, 2400);
  }
  const origin = getPublicOrigin(req);
  const title = chapterTitle ? `${novel.title} — ${chapterTitle}` : String(novel.title);
  const description = String(novel.description || `${novel.title} اثر ${novel.author} را در رپتوک بخوانید`).replace(/\s+/g, " ").slice(0, 240);
  const canonicalPath = normalizedCanonicalPath(req.path);
  const canonical = `${origin}${canonicalPath}`;
  const image = absolutePublicUrl(origin, novel.cover_url);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": chapterTitle ? "Chapter" : "Book",
    name: chapterTitle || String(novel.title),
    headline: chapterTitle ? `${chapterTitle} — ${novel.title}` : undefined,
    isPartOf: chapterTitle ? { "@type": "Book", name: String(novel.title), url: `${origin}/novels/${encodeURIComponent(novel.id)}` } : undefined,
    author: { "@type": "Person", name: String(novel.author || "") },
    description,
    image,
    url: canonical,
  };
  const head = [
    `<title>${escapeHtmlAttribute(title)} | رپتوک</title>`,
    `<meta name="description" content="${escapeHtmlAttribute(description)}" />`,
    `<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />`,
    `<link rel="canonical" href="${escapeHtmlAttribute(canonical)}" />`,
    `<meta property="og:site_name" content="رپتوک" />`,
    `<meta property="og:type" content="book" />`,
    `<meta property="og:title" content="${escapeHtmlAttribute(title)}" />`,
    `<meta property="og:description" content="${escapeHtmlAttribute(description)}" />`,
    `<meta property="og:url" content="${escapeHtmlAttribute(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtmlAttribute(image)}" />`,
    `<meta property="og:image:alt" content="جلد ${escapeHtmlAttribute(novel.title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtmlAttribute(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtmlAttribute(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtmlAttribute(image)}" />`,
    `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");
  const initialContent = [
    `<main data-server-seo="true">`,
    `<article>`,
    `<h1>${escapeHtmlAttribute(chapterTitle || novel.title)}</h1>`,
    chapterTitle ? `<p>از <a href="${escapeHtmlAttribute(`/novels/${encodeURIComponent(novel.id)}`)}">${escapeHtmlAttribute(novel.title)}</a> نوشته ${escapeHtmlAttribute(novel.author)}</p>` : `<p>نوشته ${escapeHtmlAttribute(novel.author)}</p>`,
    `<p>${escapeHtmlAttribute(chapterExcerpt || description)}</p>`,
    `</article>`,
    `</main>`,
  ].join("");
  return { head, initialContent, canonical };
}

async function authorSeoForPath(req: express.Request) {
  const match = req.path.match(/^\/authors\/([^/]+)\/?$/);
  if (!match) return null;
  const account = await resolveUsername(decodeURIComponent(match[1]));
  if (!account) return null;
  const username = String(account.username || "").trim();
  const title = `${username} — نویسنده در رپتوک`;
  const description = `خواندن رمان‌های تحت وب اصلی و تازه‌های ${username} در رپتوک.`;
  const origin = getPublicOrigin(req);
  return genericSeoHead(req, {
    title,
    description,
    indexable: true,
    type: "profile",
    image: account.avatar,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Person",
      name: username,
      url: `${origin}/authors/${encodeURIComponent(username)}`,
      image: absolutePublicUrl(origin, account.avatar),
    },
  });
}

function getPublicOrigin(req: express.Request) {
  const configured = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(configured)) {
    const url = new URL(configured);
    // ✅ Always force HTTPS in production for canonical URLs.
    if (process.env.NODE_ENV === "production") url.protocol = "https:";
    return url.origin;
  }
  // ✅ SECURITY: When APP_URL is unset in production, do not fall back to
  // x-forwarded-proto or req.host — these can be poisoned by a misconfigured
  // proxy and would enable cache-poisoning attacks. Log a warning and refuse
  // to construct a canonical URL.
  if (process.env.NODE_ENV === "production") {
    console.warn("[security] APP_URL is not set in production; canonical URLs will be unavailable.");
    return "https://example.invalid";
  }
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProtocol || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

async function applyPaidPremiumOrder(session: any, providerEventId?: string) {
  const orderId = session.metadata?.order_id;
  const userId = session.metadata?.user_id;
  const months = Number(session.metadata?.months || 1);
  if (!orderId || !userId || ![1, 3, 6].includes(months)) return false;

  const { data: order } = await supabase.from("premium_orders").select("*").eq("id", orderId).eq("user_id", userId).single();
  if (!order || order.status === "paid") return true;

  const { data: user } = await supabase.from("users").select("premium_until").eq("id", userId).single();
  const start = user?.premium_until && new Date(user.premium_until) > new Date() ? new Date(user.premium_until) : new Date();
  start.setMonth(start.getMonth() + months);

  const premiumType = session.metadata?.premium_type === "writer" ? "writer" : "reader";
  if (premiumType === "reader") await supabase.from("users").update({ is_premium: true, premium_plan: `${months}m-no-ads`, premium_until: start.toISOString() }).eq("id", userId);
  await applyPremiumAction(userId, null, {
    action: "grant", premiumType, entitlementId: `paid-${premiumType}-${orderId}`,
    source: "paid_subscription", startsAt: new Date().toISOString(), expiresAt: start.toISOString(),
    paymentSubscriptionId: String(session.subscription || session.id || orderId),
    autoRenew: !!session.subscription, reason: "Stripe payment"
  });
  // ✅ SECURITY: Store only the minimum required fields. The full Stripe
  // session object can contain customer email, masked card, shipping address,
  // and other PII. Storing it expands the blast radius of a database leak.
  const minimalPayload = {
    id: session?.id || null,
    payment_status: session?.payment_status || null,
    amount_total: session?.amount_total || null,
    currency: session?.currency || null,
    customer: typeof session?.customer === "string" ? session.customer : null,
    subscription: typeof session?.subscription === "string" ? session.subscription : null,
  };

  await supabase.from("premium_orders").update({
    status: "paid",
    paid_at: new Date().toISOString(),
    provider_event_id: providerEventId || null,
    provider_payload: JSON.stringify(minimalPayload)
  }).eq("id", orderId);
  return true;
}

async function provisionAdminAccount() {
  try {
    const adminUsername = process.env.INITIAL_ADMIN_USERNAME;
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
    if (!adminUsername || !adminPassword || adminPassword.length < 16) {
      return;
    }
    if (!validateUsername(adminUsername).ok) return;

    const { data: existing, error: checkError } = await supabase
      .from('users')
      .select('id')
      .ilike('username', adminUsername)
      .single();

    if (checkError && checkError.code !== 'PGRST116' && checkError.code !== '406' && checkError.code !== 'PGRST205') {
       return;
    }

    if (!existing) {
      if (await isUsernameUnavailable(adminUsername)) return;
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      const adminId = `admin-master-${crypto.randomUUID()}`;
      await supabase.from('users').insert({
        id: adminId,
        username: adminUsername,
        email: adminUsername,
        password: hashedPassword,
        role: "owner",
        level: 99,
        xp: 9999,
        coins: 99999,
        streak: 100,
        avatar: "OF"
      });
      console.log("Admin account safely provisioned.");
    }
  } catch (err) {
    // ✅ SECURITY: Log provisioning errors. Previously silently swallowed.
    console.error("[provisionAdminAccount] Failed:", err instanceof Error ? err.message : String(err));
  }
}

async function seedInitialDatabase() {
  // ✅ SECURITY: Never seed sample data in production. A misconfigured
  // NODE_ENV would otherwise drop predictable test novels into the live
  // database, where attackers could abuse them as a vector.
  if (process.env.NODE_ENV === "production") {
    return;
  }
  if (process.env.SEED_INITIAL_NOVELS !== "true") {
    // Even in dev, only seed when explicitly requested.
    return;
  }
  try {
    // Check if table exists and counts > 0
    const { data: novels, error: countError } = await supabase.from('novels').select('id').limit(1);
    
    if (countError && countError.code === 'PGRST205') {
       // Table does not exist, can't seed
       return;
    }

    if (!novels || novels.length === 0) {
      console.log("Seeding initial novels into the database...");
      
      const defaultNovels = [
        {
          id: "seed-novel-1",
          title: "The System's Final Heir",
          author_id: "admin-master",
          author: "Admin",
          cover_url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80",
          description: "A world reborn through holographic systems. One scavenger finds the ultimate core.",
          rating: 4.8,
          status: "Ongoing",
          approval_status: "approved",
          genre: "LitRPG",
          reviews_count: 0,
          views_count: 50,
          is_completed: false
        },
        {
          id: "seed-novel-2",
          title: "Whispers of the Nebula",
          author_id: "admin-master",
          author: "Admin",
          cover_url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80",
          description: "Far beyond the solar rim, ancient entities begin waking up.",
          rating: 4.5,
          status: "Ongoing",
          approval_status: "approved",
          genre: "Sci-Fi",
          reviews_count: 0,
          views_count: 120,
          is_completed: false
        }
      ];

      for (const nvl of defaultNovels) {
        await supabase.from('novels').insert(nvl);
        // Seed chapter 1
        await supabase.from('chapters').insert({
          id: "ch-" + nvl.id + "-1",
          novel_id: nvl.id,
          title: "Chapter 1: The Gathering",
          word_count: 1500,
          order_index: 0
        });
      }
      console.log("Database seeded with sample novels.");
    }
  } catch (err) {
    console.error("Warning: Seeding failed.", err);
  }
}

async function startServer() {
  if (process.env.NODE_ENV === "production" && !String(process.env.APP_URL || "").trim()) {
    // Canonical/SEO URLs fall back to proxy headers when APP_URL is unset.
    // Behind a misconfigured proxy that allows host-header cache poisoning,
    // so production deployments must pin the canonical origin.
    console.warn("Warning: APP_URL is not set; falling back to request headers for canonical URLs. Set APP_URL to the canonical HTTPS origin in production.");
  }
  await provisionAdminAccount();
  await seedAchievements();
  await scrubBannedTaxonomyFromDatabase();
  await publishDueScheduledChapters();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || "127.0.0.1";
  const hmrEnabled = process.env.DISABLE_HMR !== "true" && process.env.VITE_ENABLE_HMR === "true";

  // ✅ SECURITY: Trust proxy based on actual deployment topology.
  // Behind Cloudflare (1 hop) + Nginx (1 hop) = 2 hops.
  // Behind a single Nginx = 1 hop.
  // Default to 1 (most common deployment) but allow override via env.
  const trustProxyHops = Number(process.env.TRUSTED_PROXY_HOPS || 1);
  if (!Number.isFinite(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    console.warn(`[security] Invalid TRUSTED_PROXY_HOPS=${trustProxyHops}, defaulting to 1.`);
    app.set('trust proxy', 1);
  } else {
    app.set('trust proxy', trustProxyHops);
  }

  app.use((req, res, next) => {
    const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    const redirect = canonicalWwwRedirect(
      process.env.APP_URL,
      requestHost,
      req.originalUrl,
      process.env.NODE_ENV === "production",
    );
    if (!redirect) return next();
    return res.set("Cache-Control", "public, max-age=3600").redirect(308, redirect);
  });

  // Collapse the trailing-slash variants of public, indexable pages into the
  // exact URL used by canonical tags, internal links, and the sitemap.
  app.use((req, res, next) => {
    if (!(req.method === "GET" || req.method === "HEAD") || req.path === "/" || !req.path.endsWith("/")) return next();
    const withoutTrailingSlash = req.path.replace(/\/+$/, "");
    const isIndexablePublicRoute = /^\/novels\/[^/]+(?:\/chapters\/[^/]+)?$/.test(withoutTrailingSlash)
      || /^\/authors\/[^/]+$/.test(withoutTrailingSlash)
      || Object.prototype.hasOwnProperty.call(STATIC_PAGE_SEO, withoutTrailingSlash);
    if (!isIndexablePublicRoute) return next();
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    return res
      .status(308)
      .set("Cache-Control", "public, max-age=3600")
      .set("Location", `${withoutTrailingSlash}${query}`)
      .send(`Redirecting to ${withoutTrailingSlash}`);
  });

  // Use Helmet for advanced security headers.
  // In development, Vite injects inline HMR client scripts and opens WebSocket connections,
  // so we disable CSP here to avoid blocking the local dev server.
  // In production we keep a stricter CSP policy.
  const helmetOptions: any = {
    crossOriginEmbedderPolicy: false,
    // Origin-Agent-Cluster is a performance hint, not a security boundary.
    // Leaving Helmet's opt-in enabled after older site-keyed responses causes
    // Chromium to warn for every page in the browsing context group.
    originAgentCluster: false,
    // Ad providers use the publisher origin/referrer to validate approved
    // inventory. Preserve the origin on cross-site requests without leaking a
    // same-origin page URL to third parties.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  };

  if (process.env.NODE_ENV === "production") {
    helmetOptions.contentSecurityPolicy = {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        connectSrc: ["'self'", "https:", "wss:"],
        imgSrc: ["'self'", "data:", "https:"],
        mediaSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "https:", "data:", "https://fonts.gstatic.com"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    };
  } else {
    helmetOptions.contentSecurityPolicy = false;
  }

  app.use(helmet(helmetOptions));

  if (process.env.NODE_ENV === "production") {
    // Hash every inline <script> that actually ships inside the served HTML
    // shell. Deriving the hashes from the built file (instead of hard-coding
    // them) means editing index.html can never block the page's own bootstrap.
    const applicationPolicy = buildApplicationContentSecurityPolicy(shellInlineScriptHashes());
    app.use((req, res, next) => {
      if (!(["GET", "HEAD"].includes(req.method)) || req.path.startsWith("/api/") || !req.accepts("html")) return next();
      res.setHeader("Content-Security-Policy", applicationPolicy);
      next();
    });
  }

  // Rate Limiting Config
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.APP_RATE_LIMIT_PER_15_MINUTES || 3000),
    standardHeaders: true,
    legacyHeaders: false,
    message: "تعداد درخواست‌ها از این آی‌پی بیش از حد مجاز است؛ لطفاً بعداً دوباره تلاش کنید.",
    skip: (req) => req.method === "OPTIONS"
      || req.path === "/api/health"
      || req.path === "/sitemap.xml"
      || req.path === "/robots.txt"
      || req.path.startsWith("/uploads/")
      || /^\/api\/novels\/[^/]+\/cover$/.test(req.path)
    // omit custom keyGenerator to use the default ipKeyGenerator which is safe for IPv6
  });

  // Apply the rate limiting middleware to all requests
  app.use(limiter);

  app.get(["/favicon.ico", "/favicon.svg"], (_req, res) => {
    sendFavicon(res);
  });
  app.get("/robots.txt", (req, res) => {
    const origin = canonicalSitemapOrigin(process.env.APP_URL, getPublicOrigin(req));
    res
      .status(200)
      .set("Cache-Control", "public, max-age=300")
      .type("text/plain; charset=utf-8")
      .send(`User-agent: *\nAllow: /\nAllow: /api/novels/*/cover\nDisallow: /admin\nDisallow: /profile\nDisallow: /writer\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`);
  });
  // The sitemap fans out across every novel/chapter/user; compute it at most
  // once per TTL and serve the cached document otherwise.
  let sitemapCache: { xml: string; expiresAt: number } | null = null;
  const SITEMAP_CACHE_TTL_MS = Number(process.env.SITEMAP_CACHE_TTL_MS || 10 * 60 * 1000);
  app.get("/sitemap.xml", async (req, res) => {
    const origin = canonicalSitemapOrigin(process.env.APP_URL, getPublicOrigin(req));
    if (sitemapCache && sitemapCache.expiresAt > Date.now()) {
      return res
        .status(200)
        .set("Cache-Control", "public, max-age=300, s-maxage=900")
        .set("Content-Type", "application/xml; charset=utf-8")
        .send(sitemapCache.xml);
    }
    const staticPages = [
      ["/", "daily", 1.0],
      ["/discover", "daily", 0.9],
      ["/eventstatus", "daily", 0.8],
      ["/forums", "daily", 0.7],
      ["/premium", "monthly", 0.5],
      ["/support", "monthly", 0.4],
      ["/about-us", "monthly", 0.5],
      ["/contact-us", "yearly", 0.4],
      ["/rules", "yearly", 0.3],
      ["/terms-of-service", "yearly", 0.3],
      ["/privacy-policy", "yearly", 0.3],
      ["/dmca", "yearly", 0.3],
    ] as const;
    const urls = staticPages.map(([pathname, changefreq, priority]) =>
      sitemapUrl(origin, pathname, { changefreq, priority })
    );

    try {
      const { data: novels, error: novelsError } = await supabase
        .from("novels")
        .select("id, author, author_id, created_at, updated_at")
        .eq("approval_status", "approved")
        .order("created_at", { ascending: false });
      if (novelsError) throw novelsError;

      const novelIds = (novels || []).map((novel: any) => novel.id);
      const chaptersResult = novelIds.length
        ? await supabase.from("chapters").select("id, novel_id, status, moderation_status, scheduled_at, published_at, created_at, updated_at").in("novel_id", novelIds)
        : { data: [], error: null };
      if (chaptersResult.error) throw chaptersResult.error;

      const now = Date.now();
      const publishedChapters = (chaptersResult.data || []).filter((chapter: any) =>
        isChapterVisibleToUser(chapter, false)
        && (!chapter.scheduled_at || new Date(chapter.scheduled_at).getTime() <= now)
      );
      const authorIds = [...new Set<string>((novels || []).map((novel: any) => String(novel.author_id || "")).filter(Boolean))];
      const { data: authorAccounts } = authorIds.length
        ? await supabase.from("users").select("id, username").in("id", authorIds)
        : { data: [] as any[] };
      const authors: string[] = [...new Set<string>((authorAccounts || []).map((account: any) => String(account.username || "").trim()).filter(Boolean))];
      urls.push(
        ...(novels || []).map((novel: any) => sitemapUrl(origin, `/novels/${encodeURIComponent(novel.id)}`, {
          lastmod: novel.updated_at || novel.created_at,
          changefreq: "weekly",
          priority: 0.8,
        })),
        ...publishedChapters.map((chapter: any) => sitemapUrl(origin, `/novels/${encodeURIComponent(chapter.novel_id)}/chapters/${encodeURIComponent(chapter.id)}`, {
          lastmod: chapter.updated_at || chapter.published_at || chapter.created_at,
          changefreq: "monthly",
          priority: 0.6,
        })),
        ...authors.map((author) => sitemapUrl(origin, `/authors/${encodeURIComponent(author)}`, { changefreq: "weekly", priority: 0.6 }))
      );
    } catch (error) {
      // A temporary database problem must not remove every public page from
      // the sitemap. Static routes remain valid while dynamic entries recover.
      console.error("Failed to add dynamic sitemap entries:", error);
    }
    const xml = buildSitemapDocument(urls);
    sitemapCache = { xml, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS };
    res
      .status(200)
      .set("Cache-Control", "public, max-age=300, s-maxage=900")
      .set("Content-Type", "application/xml; charset=utf-8")
      .send(xml);
  });

  app.get("/media/reading-music/:trackId.wav", (req, res) => {
    const audio = getReadingMusicTrack(req.params.trackId);
    if (!audio) return res.status(404).json({ error: "قطعه موسیقی مطالعه پیدا نشد." });
    const range = req.headers.range;
    res
      .set("Content-Type", "audio/wav")
      .set("Cache-Control", "public, max-age=86400, immutable")
      .set("Accept-Ranges", "bytes")
      .set("X-Content-Type-Options", "nosniff");
    if (!range) {
      return res.status(200).set("Content-Length", String(audio.length)).send(audio);
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = match?.[1] ? Number(match[1]) : NaN;
    let end = match?.[2] ? Number(match[2]) : audio.length - 1;
    if (match && !match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      start = Math.max(0, audio.length - suffixLength);
      end = audio.length - 1;
    }
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= audio.length) {
      return res.status(416).set("Content-Range", `bytes */${audio.length}`).end();
    }
    end = Math.min(end, audio.length - 1);
    const chunk = audio.subarray(start, end + 1);
    return res
      .status(206)
      .set("Content-Range", `bytes ${start}-${end}/${audio.length}`)
      .set("Content-Length", String(chunk.length))
      .send(chunk);
  });

  // Parse cookies
  app.use(cookieParser());

  app.get(["/coffee", "/teapot", "/api/teapot"], async (req, res) => {
    const user = await getActiveUser(req, false).catch(() => null);
    if (user) await checkAndAwardAchievement(user.id, "ach_secret_easter_founder");
    res
      .status(418)
      .set("X-Teapot", "short-and-stout")
      .json({
        status: 418,
        error: "من یک قوری هستم",
        message: user
          ? "قوری را پیدا کردید! برای یک سورپرایز کوچک به اعلان‌هایتان سر بزنید."
          : "این سرور از دم‌کردن قهوه امتناع می‌ورزد؛ چون برای همیشه یک قوری است.",
        teapot: "🫖"
      });
  });

  app.post("/api/premium/stripe-webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) return res.status(400).json({ error: "وبهوک استرایپ پیکربندی نشده است." });
      const signature = String(req.headers["stripe-signature"] || "");
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
      if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
        return res.status(400).json({ error: "امضای استرایپ نامعتبر است." });
      }

      const event = JSON.parse(rawBody.toString("utf8"));
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        const session = event.data?.object;
        if (session?.payment_status === "paid") {
          await applyPaidPremiumOrder(session, event.id);
        }
      }
      res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err);
      res.status(400).json({ error: "پردازش وبهوک ناموفق بود." });
    }
  });

  // JSON request body parser
  // Novel payloads can contain an opening chapter and a compressed cover.
  // This outer parser must not be smaller than the API router's own limit.
  app.use(express.json({ limit: "12mb" }));
  app.use(express.urlencoded({ extended: true, limit: "12mb" }));

  // Create uploads directory if it doesnt exist
  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Public uploads must be served through metadata checks so private files and
  // backup folders cannot be fetched by guessing a filesystem path.
  app.get("/uploads/avatars/:fileName", async (req, res) => {
    try {
      const fileName = path.basename(req.params.fileName || "");
      if (!fileName || fileName !== req.params.fileName || !/^[a-zA-Z0-9_.-]+\.(jpe?g|png|webp|gif)$/i.test(fileName)) {
        return res.status(404).json({ error: "تصویر نمایه پیدا نشد." });
      }

      const avatarDir = path.resolve(uploadDir, "avatars");
      const resolved = path.resolve(avatarDir, fileName);
      if (!resolved.startsWith(avatarDir + path.sep) || !fs.existsSync(resolved)) {
        return sendAvatarPlaceholder(res);
      }

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.sendFile(resolved);
    } catch (error: any) {
      console.error("Avatar retrieval failed", {
        fileName: req.params.fileName,
        message: error?.message || String(error),
        code: error?.code,
      });
      res.status(404).json({ error: "تصویر نمایه پیدا نشد." });
    }
  });

  app.get("/uploads/:fileName", async (req, res) => {
    try {
      const fileName = path.basename(req.params.fileName || "");
      if (!fileName || fileName !== req.params.fileName) {
        return res.status(404).json({ error: "فایل پیدا نشد." });
      }

      const publicUrl = `/uploads/${fileName}`;
      const { data: file } = await supabase
        .from("files")
        .select("url, mimetype, visibility, deleted_at")
        .eq("url", publicUrl)
        .eq("visibility", "public")
        .is("deleted_at", null)
        .single();

      if (!file) return res.status(404).json({ error: "فایل پیدا نشد." });

      const resolved = path.resolve(uploadDir, fileName);
      const root = path.resolve(uploadDir);
      if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
        return res.status(404).json({ error: "فایل پیدا نشد." });
      }

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.type(file.mimetype || "application/octet-stream");
      res.sendFile(resolved);
    } catch (error: any) {
      console.error("Public upload retrieval failed", {
        fileName: req.params.fileName,
        message: error?.message || String(error),
        code: error?.code,
        detail: error?.detail,
      });
      res.status(404).json({ error: "فایل پیدا نشد." });
    }
  });

  app.get(["/authors/:username", "/author/:username"], async (req, res, next) => {
    try {
      const account = await resolveUsername(req.params.username);
      if (!account) return next();
      const requested = String(req.params.username || "");
      const isCanonical =
        req.path.startsWith("/authors/") &&
        requested === String(account.username || "");
      if (isCanonical) return next();
      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      // ✅ SECURITY: Short cache TTL. A 5-minute cache would serve stale
      // redirects after a username change, sending users to a 404 page.
      res
        .status(308)
        .set("Cache-Control", "private, max-age=30")
        .set("Location", `/authors/${encodeURIComponent(account.username)}${query}`)
        .end(); // ✅ SECURITY: Don't include username in body to prevent reflection XSS.
    } catch (error) {
      console.error("Profile alias redirect lookup failed.", error);
      next();
    }
  });

  // Defense in depth: server-local backup/storage paths must never fall
  // through to the SPA or a future static-file middleware. Return the same 404
  // for files and directories so their names and existence are not disclosed.
  app.use([
    "/storage", "/storage/*path",
    "/backup", "/backup/*path",
    "/backups", "/backups/*path",
    "/api/admin/backups", "/api/admin/backups/*path",
    "/api/admin/database-backup", "/api/admin/database-backup/*path",
  ], (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ error: "Not found" });
  });

  // Mount API endpoints
  app.use("/api", apiRouter);
  app.use("/api", (err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const status = Number(err?.status || err?.statusCode || 400);
    if (status === 413 || err?.type === "entity.too.large") {
      return res.status(413).json({
        error: "حجم رمان برای ذخیره بیش از حد مجاز است. ابتدا تصویر جلد را بارگذاری کنید یا از تصویری کمتر از ۱۰ مگابایت استفاده کنید."
      });
    }
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "فایل انتخاب‌شده بیش از حد بزرگ است. از تصویری کوچک‌تر از حد مجاز نمایش‌داده‌شده استفاده کنید." });
    }
    if (/invalid file type|unsupported.*type|نوع فایل|نوع سند|پشتیبانی نمی‌شود/i.test(String(err?.message || ""))) {
      return res.status(415).json({ error: "این نوع فایل پشتیبانی نمی‌شود. تصویری با قالب JPEG یا PNG یا WebP انتخاب کنید." });
    }
    // Only intentionally-authored Persian messages reach clients; anything
    // else (driver text, stack details) is logged and replaced by a generic.
    const rawMessage = String(err?.message || "");
    // ✅ SECURITY: Allowlist of Persian error messages that are safe to return
    // to clients. Any other Persian-language error (e.g. from third-party libs
    // or DB driver localization) is replaced with a generic message.
    const SAFE_CLIENT_ERRORS = new Set([
      "رمز عبور یا کد اشتباه است.",
      "نام کاربری یا رمز عبور نادرست است.",
      "این حساب توسط مدیر مسدود شده است.",
      "حساب کاربری یافت نشد.",
      "نشست شما معتبر نیست.",
      "دسترسی غیرمجاز.",
      "ثبت‌نام در حال حاضر توسط مدیریت بسته شده است.",
      "این نام کاربری قبلاً استفاده شده یا برای همیشه رزرو شده است.",
      "حسابی با این ایمیل از قبل وجود دارد.",
      "حسابی با این شماره تلفن از قبل وجود دارد.",
      "کد تأیید نامعتبر یا منقضی شده است.",
      "کد بازنشانی نامعتبر یا منقضی شده است.",
      "جزئیات بازنشانی نامعتبر است. کد و شرایط رمز عبور را بررسی کنید.",
      "فایل در بررسی امنیتی رد شد.",
      "نوع فایل پشتیبانی نمی‌شود.",
      "حجم فایل بیش از حد مجاز است.",
      "این نوع فایل پشتیبانی نمی‌شود. تصویری با قالب JPEG یا PNG یا WebP انتخاب کنید.",
    ]);
    const clientMessage = SAFE_CLIENT_ERRORS.has(rawMessage)
      ? rawMessage
      : "درخواست ناموفق بود.";
    if (!SAFE_CLIENT_ERRORS.has(rawMessage)) console.error("Unhandled request error:", err);
    res.status(status >= 500 ? 400 : status).json({ error: clientMessage });
  });

  const httpServer = http.createServer(app);
  const defaultAllowedOrigins = [
    "https://demo.reptoc.xyz",
    "https://reptoc.xyz",
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
  
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error("Origin not allowed"));
      },
      credentials: true
    }
  });

  const dmRateBuckets = new Map<string, { count: number; resetAt: number }>();
  function timingSafeEqual(a: unknown, b: unknown): boolean {
    const left = Buffer.from(String(a ?? ""), "utf8");
    const right = Buffer.from(String(b ?? ""), "utf8");
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  }

  io.use(async (socket, next) => {
    const csrfToken = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "";
    if (!csrfToken) return next(new Error("Authentication error"));
    try {
      const rawCookie = socket.handshake.headers.cookie || "";
      const cookieMap = Object.fromEntries(
        rawCookie
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const [key, ...rest] = part.split("=");
            return [key, decodeURIComponent(rest.join("=") || "")];
          })
      );
      let sessionId = cookieMap.sessionId || cookieMap.session_token;
      if (sessionId) {
        const dec = decrypt(sessionId);
        if (dec) sessionId = dec;
      }
      if (!sessionId) return next(new Error("Invalid session"));

      const { data: sessions } = await supabase
        .from("sessions")
        .select("user_id, expires_at, csrf_token")
        .eq("id", hashSessionToken(sessionId))
        .limit(1);
      const session = Array.isArray(sessions) ? sessions[0] : sessions;
      if (!session || new Date(session.expires_at).getTime() < Date.now()) return next(new Error("Invalid session"));
      if (!timingSafeEqual(session.csrf_token, csrfToken)) return next(new Error("Invalid token"));
      
      const { data: user } = await supabase.from("users").select("id, username, role").eq("id", session.user_id).single();
      if (!user) return next(new Error("User not found"));
      
      socket.data.user = user;
      next();
    } catch (e) {
      next(new Error("Server error"));
    }
  });

  io.on("connection", (socket) => {
    // Join a general channel for direct messages
    socket.join(`user_id_${socket.data.user.id}`);
    // Forum live updates
    // ✅ SECURITY: Validate threadId before joining. Prevents injection of
    // arbitrary room names like `user_id_<victim>` via crafted threadId strings.
    const VALID_THREAD_ID = /^[a-zA-Z0-9_-]{1,100}$/;
    socket.on("join_thread", (threadId) => {
      const id = String(threadId || "");
      if (!VALID_THREAD_ID.test(id)) return;
      socket.join(`thread_${id}`);
    });
    socket.on("leave_thread", (threadId) => {
      const id = String(threadId || "");
      if (!VALID_THREAD_ID.test(id)) return;
      socket.leave(`thread_${id}`);
    });
    
    socket.on("new_forum_post", async (data) => {
      const threadId = typeof data?.threadId === "string" ? data.threadId : "";
      const postId = typeof data?.post?.id === "string" ? data.post.id : "";
      if (!threadId || !postId) return;

      const { data: post } = await supabase
        .from("forum_posts")
        .select("*, users!inner(username, role, avatar)")
        .eq("id", postId)
        .eq("thread_id", threadId)
        .single();
      if (!post || post.user_id !== socket.data.user.id) return;

      io.to(`thread_${threadId}`).emit("forum_post_added", post);
    });

    // Private Live Messaging (per-user token bucket: 10 messages / 10s)
    // ✅ SECURITY: Rate limit per USER ID, not per socket ID. A user who
    // disconnects and reconnects would otherwise get a fresh bucket and bypass
    // the limit.
    socket.on("send_direct_message", async (data) => {
      try {
        const now = Date.now();
        const userId = socket.data.user.id;
        const bucket = dmRateBuckets.get(userId) || { count: 0, resetAt: now + 10_000 };
        if (now > bucket.resetAt) {
          bucket.count = 0;
          bucket.resetAt = now + 10_000;
        }
        bucket.count += 1;
        dmRateBuckets.set(userId, bucket);
        if (bucket.count > 10) return;

        const to = String(data?.to || "").trim().slice(0, 80).replace(/[<>]/g, "");
        const subject = String(data?.subject || "").trim().slice(0, 160).replace(/[<>]/g, "");
        const snippet = String(data?.snippet || data?.content || "").trim().slice(0, 5000).replace(/[<>]/g, "");
        if (!to || !subject || !snippet) return;

        const [{ data: currentSender }, recipient] = await Promise.all([
          supabase.from("users").select("id, username").eq("id", socket.data.user.id).single(),
          resolveUsername(to),
        ]);
        if (!currentSender || !recipient || recipient.id === currentSender.id) return;
        const { data: block } = await supabase
          .from("blocked_users")
          .select("id")
          .or(`and(blocker_user_id.eq.${recipient.id},blocked_user_id.eq.${currentSender.id}),and(blocker_user_id.eq.${currentSender.id},blocked_user_id.eq.${recipient.id})`)
          .limit(1);
        if (block && block.length > 0) return;

        const messageId = `msg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
        const createdAt = new Date().toISOString();
        await supabase.from("messages").insert({
          id: messageId,
          recipient_id: recipient.id,
          sender_id: currentSender.id,
          username: recipient.username,
          sender: currentSender.username,
          subject,
          snippet,
          is_read: 0,
          created_at: createdAt
        });

        const payload = {
          id: messageId,
          sender: currentSender.username,
          subject,
          snippet,
          date: createdAt,
          created_at: createdAt,
          read: false
        };
        io.to(`user_id_${recipient.id}`).emit("receive_direct_message", payload);
      } catch (err) {
        console.error("Socket direct message failed:", err);
      }
    });

    socket.on("disconnect", () => {
      // ✅ Note: do NOT delete the user's bucket on socket disconnect.
      // Only delete after natural expiry, so reconnecting users still
      // get rate-limited.
    });
  });

  // Realtime notification fan-out: persistence publishes to the bus, the
  // socket layer forwards to the recipient's private room instantly.
  notificationBus.on("notification", (payload: { userId: string; [key: string]: unknown }) => {
    try {
      io.to(`user_id_${payload.userId}`).emit("notification_new", payload);
    } catch (error) {
      console.error("Realtime notification forward failed:", error);
    }
  });

  // Vite middleware for development
  const shouldUseViteMiddleware = process.env.ENABLE_VITE_MIDDLEWARE === "true" && process.env.DISABLE_VITE_MIDDLEWARE !== "true";
  app.use((req, res, next) => {
    // ✅ SECURITY: Block any path whose final segment is `.env` or `.env.*`
    // after URL decoding. The original regex `(^|\/)\.env($|[./])` did not
    // match `/foo/.env` (because `\/` matched the slash, but the regex
    // boundary test failed), nor did it match `/.env.example` reliably.
    // The new test normalizes path separators and rejects `.env` appearing
    // anywhere as a filename component.
    const cleanPath = decodeURIComponent(req.path || "").replace(/\\/g, "/");
    const segments = cleanPath.split("/").map((s) => s.trim()).filter(Boolean);
    const isEnvFile = segments.some((segment) => /^\.env(\.|$)/i.test(segment));
    if (isEnvFile) {
      return res.status(404).type("application/json").send({ error: "Not found" });
    }
    next();
  });
  if (shouldUseViteMiddleware) {
    console.log("Starting backend server in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: {
        allowedHosts: ["demo.reptoc.xyz", "reptoc.xyz"],
        middlewareMode: true,
        hmr: hmrEnabled ? { port: Number(process.env.VITE_HMR_PORT || 24678) } : false
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting backend server in production mode...");
    const distPath = path.resolve(applicationRoot, "dist", "client");
    const indexPath = path.join(distPath, "index.html");
    const clientBuildReady = fs.existsSync(indexPath);
    if (!clientBuildReady) {
      console.error(
        `Production client build is missing: ${indexPath}. Run "npm run build" before "npm start" and deploy both build/server.cjs and dist/client.`
      );
    }
    app.get(["/server.cjs", "/server.cjs.map", "/server.js", "/server.js.map"], (_req, res) => {
      res.status(404).type("application/json").send({ error: "Not found" });
    });
    if (clientBuildReady) {
      app.get("/sw.js", (_req, res) => {
        res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0");
        res.sendFile(path.join(distPath, "sw.js"));
      });
      app.use(express.static(distPath, {
        index: false,
        setHeaders: (res, filePath) => {
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        }
      }));

      // Recover tabs that were opened on an older deployment whose lazy-route
      // filename is no longer present. Named route chunks have stable prefixes,
      // so redirect only those known files to the newest matching build asset.
      const lazyRouteChunkPrefixes = new Set([
        "Discover", "Forums", "Premium", "DailyChallenges", "OfflineDownloads",
        "NovelDetails", "Reader", "UserProfile", "AuthorProfile", "Writer",
        "AuthorityCenter", "EditorPanel", "Bookmarks", "Support", "EventStatus",
        "WorldbuildingWorkspace", "NotFound",
      ]);
      app.get("/assets/:assetName", (req, res, next) => {
        const requested = path.basename(String(req.params.assetName || ""));
        if (!requested.endsWith(".js")) return next();
        const prefix = [...lazyRouteChunkPrefixes].find((name) => requested.startsWith(`${name}-`));
        if (!prefix) return next();
        try {
          const candidates = fs.readdirSync(path.join(distPath, "assets"))
            .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(".js"))
            .map((name) => ({ name, modified: fs.statSync(path.join(distPath, "assets", name)).mtimeMs }))
            .sort((left, right) => right.modified - left.modified);
          if (!candidates[0]) return next();
          res.setHeader("Cache-Control", "private, no-store");
          return res.redirect(307, `/assets/${encodeURIComponent(candidates[0].name)}`);
        } catch {
          return next();
        }
      });
    }
    app.get("*", async (req, res) => {
      if (!fs.existsSync(indexPath)) {
        return res.status(503).type("application/json").send({
          error: "Client build is missing.",
          detail: 'Run "npm run build" before starting the production server.',
        });
      }
      const normalizedPath = req.path.replace(/\/+$/, "") || "/";
      const knownClientRoute = ["/", "/discover", "/ranking", "/eventstatus", "/notifications", "/challenges", "/offline", "/writer", "/forums", "/support", "/premium", "/profile", "/editor-panel", "/authority-center", "/bookmarks", "/rules", "/terms-of-service", "/privacy-policy", "/dmca", "/contact-us", "/about-us", "/not-found"].includes(normalizedPath)
        || /^\/novels\/[^/]+(?:\/chapters\/[^/]+)?$/.test(normalizedPath)
        || /^\/novels\/[^/]+\/worldbuilding(?:\/[^/]+)?$/.test(normalizedPath)
        || /^\/authors\/[^/]+$/.test(normalizedPath);
      // The HTML contains hashed bundle names and must be revalidated so Safari
      // never tries to boot an obsolete bundle after a deployment.
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      try {
        let html = await fs.promises.readFile(indexPath, "utf8");
        if (/^\/novels\/[^/]+(?:\/chapters\/[^/]+)?$/.test(normalizedPath)) {
          const preview = await socialPreviewForPath(req);
          if (preview) {
            return res
              .status(200)
              .set("Link", `<${preview.canonical}>; rel="canonical"`)
              .type("html")
              .send(injectSeoHead(html, preview.head, preview.initialContent));
          }
          const missingHead = genericSeoHead(req, {
            title: "رمان پیدا نشد | رپتوک",
            description: "رمان یا فصل درخواستی رپتوک پیدا نشد.",
            indexable: false,
          });
          return res.status(404).type("html").send(injectSeoHead(html, missingHead));
        }

        if (/^\/authors\/[^/]+$/.test(normalizedPath)) {
          const preview = await authorSeoForPath(req);
          if (preview) return res.status(200).type("html").send(injectSeoHead(html, preview));
          const missingHead = genericSeoHead(req, {
            title: "نویسنده پیدا نشد | رپتوک",
            description: "نمایه نویسنده درخواستی رپتوک پیدا نشد.",
            indexable: false,
          });
          return res.status(404).type("html").send(injectSeoHead(html, missingHead));
        }

        const staticSeo = STATIC_PAGE_SEO[normalizedPath];
        if (staticSeo) {
          const status = normalizedPath === "/not-found" ? 404 : 200;
          const structuredData = normalizedPath === "/" ? {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "رپتوک",
            url: `${getPublicOrigin(req)}/`,
            potentialAction: {
              "@type": "SearchAction",
              target: `${getPublicOrigin(req)}/discover?q={search_term_string}`,
              "query-input": "required name=search_term_string",
            },
          } : undefined;
          const head = genericSeoHead(req, {
            title: staticSeo.title,
            description: staticSeo.description,
            indexable: staticSeo.indexable !== false,
            structuredData,
          });
          return res.status(status).type("html").send(injectSeoHead(html, head));
        }

        const privateDynamicRoute = /^\/novels\/[^/]+\/worldbuilding(?:\/[^/]+)?$/.test(normalizedPath);
        if (privateDynamicRoute) {
          const head = genericSeoHead(req, {
            title: "محیط جهان‌سازی | رپتوک",
            description: "محیط خصوصی جهان‌سازی رپتوک.",
            indexable: false,
          });
          return res.status(200).type("html").send(injectSeoHead(html, head));
        }

        const missingHead = genericSeoHead(req, {
          title: "صفحه پیدا نشد | رپتوک",
          description: "صفحه درخواستی رپتوک پیدا نشد.",
          indexable: false,
        });
        return res.status(knownClientRoute ? 200 : 404).type("html").send(injectSeoHead(html, missingHead));
      } catch (error) {
        console.error("Failed to build route metadata:", error);
        return res.status(knownClientRoute ? 200 : 404).sendFile(indexPath);
      }
    });
  }

  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const status = Number(err?.status || err?.statusCode || 400);
    const rawMessage = String(err?.message || "");
    // ✅ SECURITY: Allowlist of Persian error messages that are safe to return
    // to clients. Any other Persian-language error (e.g. from third-party libs
    // or DB driver localization) is replaced with a generic message.
    const SAFE_CLIENT_ERRORS = new Set([
      "رمز عبور یا کد اشتباه است.",
      "نام کاربری یا رمز عبور نادرست است.",
      "این حساب توسط مدیر مسدود شده است.",
      "حساب کاربری یافت نشد.",
      "نشست شما معتبر نیست.",
      "دسترسی غیرمجاز.",
      "ثبت‌نام در حال حاضر توسط مدیریت بسته شده است.",
      "این نام کاربری قبلاً استفاده شده یا برای همیشه رزرو شده است.",
      "حسابی با این ایمیل از قبل وجود دارد.",
      "حسابی با این شماره تلفن از قبل وجود دارد.",
      "کد تأیید نامعتبر یا منقضی شده است.",
      "کد بازنشانی نامعتبر یا منقضی شده است.",
      "جزئیات بازنشانی نامعتبر است. کد و شرایط رمز عبور را بررسی کنید.",
      "فایل در بررسی امنیتی رد شد.",
      "نوع فایل پشتیبانی نمی‌شود.",
      "حجم فایل بیش از حد مجاز است.",
      "این نوع فایل پشتیبانی نمی‌شود. تصویری با قالب JPEG یا PNG یا WebP انتخاب کنید.",
    ]);
    const clientMessage = SAFE_CLIENT_ERRORS.has(rawMessage)
      ? rawMessage
      : "درخواست ناموفق بود.";
    if (!SAFE_CLIENT_ERRORS.has(rawMessage)) console.error("Unhandled request error:", err);
    res.status(status >= 500 ? 400 : status).json({ error: clientMessage });
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`Reptoc backend system running smoothly at http://${HOST}:${PORT}`);
    startDiscordBotPresence();
    autoStartInboundMailIfConfigured();
  });

  const scheduledChapterTimer = setInterval(() => {
    publishDueScheduledChapters().catch((err) => console.error("Scheduled chapter publisher failed:", err));
  }, 60 * 1000);
  // ✅ Allow Node to exit cleanly during graceful shutdown.
  scheduledChapterTimer.unref();
}

startServer().catch((err) => {
  console.error("Critical error starting backend server:", err);
});
