import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Rate Limiters
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.GLOBAL_RATE_LIMIT_PER_MINUTE || 600),
  message: { error: "Too many requests, please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.method === "OPTIONS"
    || req.path === "/health"
    || req.path === "/api/health"
    // ✅ Stripe webhook has its own signature-based verification and must
    // not be throttled by the IP limiter — Stripe retries on 429, which
    // would amplify the load and could drop legitimate payment events.
    || req.path === "/api/premium/stripe-webhook",
});

export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many sensitive operations. Please try again later." }
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: false,
  message: { error: "Upload limit exceeded. Maximum 10 uploads per hour." }
});

/**
 * Bulk bucket for manga page scans.
 *
 * A manga chapter is dozens of separate images, so the 10-per-hour ceiling above
 * would make publishing a chapter impossible. This bucket is selected by the
 * declared `?purpose=manga-page`, which cannot be verified before the multipart
 * body is parsed — so it is deliberately only a request-rate allowance: the real
 * ceilings (per file, per novel, per account bytes, plus the malware scan) are
 * enforced in the handler and are unaffected by which bucket was used.
 */
export const mangaPageUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.MANGA_PAGE_UPLOADS_PER_HOUR || 400),
  skipSuccessfulRequests: false,
  message: { error: "تعداد بارگذاری صفحه‌های مانگا در این ساعت به سقف رسید؛ کمی بعد ادامه دهید." }
});

// Strict per-IP bucket for credential endpoints. This runs BEFORE the
// per-account limiter below: rotating usernames must never reset throttling.
export const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_IP_RATE_LIMIT_PER_15_MINUTES || 20),
  keyGenerator: (req) => ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown"),
  skip: (req) => req.method === "OPTIONS",
  message: { error: "تعداد تلاش‌های ورود از این آی‌پی بیش از حد مجاز است؛ لطفاً بعداً دوباره تلاش کنید." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Enhanced auth limiter: IP + username based (prevents brute force across multiple accounts)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown");
    const username = req.body?.username || req.body?.email || "";
    // Rate limit by IP, and also by username to prevent distributed attacks
    return `${ip}:${username}`;
  },
  skip: (req) => {
    // Skip if no username/email (will be caught by validation anyway)
    return !req.body?.username && !req.body?.email;
  },
  message: { error: "Too many login attempts. Please try again later." }
});

export const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown");
    const otpSessionToken = typeof req.body?.otpSessionToken === "string" ? req.body.otpSessionToken.slice(0, 32) : "";
    return `${ip}:otp:${otpSessionToken}`;
  },
  message: { error: "Too many OTP attempts. Please request a new code and try again." }
});

export const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 255) : "";
    return `${ip}:password-reset-request:${email}`;
  },
  message: { error: "Too many password reset requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false
});

export const passwordResetConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 255) : "";
    return `${ip}:password-reset-confirm:${email}`;
  },
  message: { error: "Too many reset code attempts. Please request a new code and try again later." },
  standardHeaders: true,
  legacyHeaders: false
});

export const interactionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.INTERACTION_RATE_LIMIT_PER_5_MINUTES || 120),
  message: { error: "You are doing this too fast. Please slow down." }
});
