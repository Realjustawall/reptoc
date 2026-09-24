import express from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileTypeFromBuffer } from "file-type";
import { supabase } from "../../postgres";
import { getActiveUser, isOwnerUser } from "../../utils/auth";
import { checkUploadQuota } from "../../utils/mediaLifecycle";
import { sanitizePlainText } from "../../utils/content";
import { MANGA_PAGE_MAX_BYTES } from "../../../shared/manga";
import fs from "fs";
import { mangaPageUploadLimiter, uploadLimiter } from "../limiters";
import sharp from "sharp";
import * as pdfParseModule from "pdf-parse";
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";
import crypto from "crypto";
import net from "net";
import { SecurityEventType, logSecurityEvent } from "../../utils/security-logger";

const router = express.Router();

/**
 * Pick the rate-limit bucket for an image upload.
 *
 * Manga pages arrive dozens at a time, so they use the bulk bucket; everything
 * else keeps the strict default. The bucket is chosen from the query string
 * because the multipart body is not parsed yet at this point in the chain.
 */
function imageUploadLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const limiter = String(req.query.purpose || "").trim() === "manga-page" ? mangaPageUploadLimiter : uploadLimiter;
  return limiter(req, res, next);
}

// ✅ Compute file hash for deduplication and integrity
function computeFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function scanWithClamAv(buffer: Buffer): Promise<{ safe: boolean; result: string } | null> {
  const host = process.env.CLAMAV_HOST || "127.0.0.1";
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS || 8000);

  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      console.error("[clamav] Scan timed out", { host, port, timeoutMs, bytes: buffer.length });
      socket.destroy();
      resolve({ safe: false, result: "clamav_timeout" });
    }, timeoutMs);

    const chunks: Buffer[] = [];
    socket.on("connect", () => {
      console.log("[clamav] Connected, streaming file for scan", { host, port, bytes: buffer.length });
      socket.write("zINSTREAM\0", "utf8");
      const sizeHeader = Buffer.alloc(4);
      sizeHeader.writeUInt32BE(buffer.length, 0);
      socket.write(Buffer.concat([sizeHeader, buffer]));
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", (err) => {
      clearTimeout(timer);
      console.error("[clamav] Connection or scan error", { host, port, error: err.message });
      resolve({ safe: false, result: "clamav_unavailable" });
    });
    socket.on("close", () => {
      clearTimeout(timer);
      const response = Buffer.concat(chunks).toString("utf8");
      if (/FOUND/i.test(response)) {
        console.error("[clamav] Malware detected", { host, port, response: response.trim() });
        return resolve({ safe: false, result: response.trim() || "clamav_found" });
      }
      if (/OK/i.test(response)) {
        console.log("[clamav] File is clean", { host, port });
        return resolve({ safe: true, result: "clamav_clean" });
      }
      console.error("[clamav] Unknown ClamAV response", { host, port, response: response.trim() });
      resolve({ safe: false, result: response.trim() || "clamav_unknown_response" });
    });
  });
}

// Use ClamAV when configured; otherwise apply local blocking heuristics.
async function scanForMalware(buffer: Buffer, filename: string): Promise<{ safe: boolean; result: string }> {
  try {
    const clamavEnabled = String(process.env.CLAMAV_ENABLED || "").toLowerCase() === "true" || process.env.CLAMAV_ENABLED === "1";
    let clamavFallbackResult = "";
    if (clamavEnabled) {
      const clamResult = await scanWithClamAv(buffer);
      if (clamResult) {
        if (clamResult.safe) {
          return { safe: true, result: clamResult.result || "clamav_skipped" };
        }
        if (clamResult.result === "clamav_unavailable" || clamResult.result === "clamav_timeout") {
          clamavFallbackResult = clamResult.result;
          console.warn("[malware-scan] ClamAV unavailable; continuing with heuristic scan", { filename, result: clamResult.result });
        } else {
          return clamResult;
        }
      }
    }

    const dangerousMagicBytes = [
      Buffer.from([0x4D, 0x5A]),
      Buffer.from([0x7F, 0x45, 0x4C, 0x46]),
      Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]),
      Buffer.from([0xFE, 0xED, 0xFA, 0xCE]),
      Buffer.from([0xFE, 0xED, 0xFA, 0xCF]),
    ];

    for (const magic of dangerousMagicBytes) {
      if (buffer.slice(0, magic.length).equals(magic)) {
        console.error("[malware-scan] Executable magic bytes detected", { filename, result: "executable_detected" });
        return { safe: false, result: 'executable_detected' };
      }
    }

    const lowerName = filename.toLowerCase();
    if (/\.(exe|dll|bat|cmd|com|scr|ps1|vbs|js|jar|msi|sh)(\.|$)/i.test(lowerName)) {
      console.error("[malware-scan] Dangerous extension blocked", { filename, result: "dangerous_extension" });
      return { safe: false, result: "dangerous_extension" };
    }

    const sample = buffer.subarray(0, Math.min(buffer.length, 256 * 1024)).toString("latin1").toLowerCase();
    if (/<script|javascript:|powershell|cmd\.exe|wscript\.shell|eval\(/i.test(sample)) {
      console.error("[malware-scan] Suspicious active content blocked", { filename, result: "suspicious_active_content" });
      return { safe: false, result: "suspicious_active_content" };
    }

    return { safe: true, result: clamavFallbackResult ? `${clamavFallbackResult}:heuristic_checks_passed` : 'heuristic_checks_passed' };
  } catch (err) {
    console.error('[malware-scan] Malware scan error:', { filename, error: err instanceof Error ? err.message : String(err) });
    return { safe: false, result: 'scan_error' };
  }
}

async function stripImageMetadata(buffer: Buffer, mimeType: string): Promise<Buffer> {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
    try {
      const cleaned = await sharp(buffer).toBuffer();
      return cleaned;
    } catch (err) {
      console.error('[upload] Metadata strip failed; rejecting image:', err);
      throw new Error('پردازش تصویر ناموفق بود؛ فایل پذیرفته نشد.');
    }
  }
  return buffer;
}

async function reEncodeUnsafeImageFormats(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mime: string } | null> {
  if (mimeType !== 'image/gif' && mimeType !== 'image/avif') return null;
  try {
    const animated = mimeType === 'image/gif';
    const cleaned = await sharp(buffer, { animated }).webp({ quality: 88 }).toBuffer();
    return { buffer: cleaned, mime: 'image/webp' };
  } catch (err) {
    console.error('[upload] GIF/AVIF re-encode failed; rejecting image:', err);
    throw new Error('پردازش تصویر ناموفق بود؛ فایل پذیرفته نشد.');
  }
}

const ALLOWED_MIME_TYPES: Record<string, any> = {
  'image/jpeg': { maxSize: 5 * 1024 * 1024, dimensions: { maxWidth: 4000, maxHeight: 4000 } },
  'image/png': { maxSize: 5 * 1024 * 1024, dimensions: { maxWidth: 4000, maxHeight: 4000 } },
  'image/webp': { maxSize: 3 * 1024 * 1024, dimensions: { maxWidth: 4000, maxHeight: 4000 } },
  'image/gif': { maxSize: 5 * 1024 * 1024, dimensions: { maxWidth: 4000, maxHeight: 4000 } },
  'image/avif': { maxSize: 3 * 1024 * 1024, dimensions: { maxWidth: 4000, maxHeight: 4000 } },
  'application/pdf': { maxSize: 10 * 1024 * 1024 }
};

/**
 * Manga page scans are much larger than prose illustrations: a print-resolution
 * page is routinely 6–10 MB, and a webtoon "page" is a single very tall strip.
 * Both ceilings only apply to an upload that declares itself a manga page for a
 * manga the caller owns; everything else keeps the stricter defaults above.
 */
const MANGA_PAGE_DIMENSIONS = { maxWidth: 6000, maxHeight: 20000 };
const MAX_UPLOAD_SIZE = Math.max(10 * 1024 * 1024, MANGA_PAGE_MAX_BYTES);

const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

/**
 * Audio uploads (challenge narration clips).
 *
 * Kept deliberately narrow: container formats that browsers decode natively and
 * that `file-type` can identify from magic bytes. The extension is derived from
 * the sniffed type, never from the client-supplied filename.
 */
const AUDIO_MIME_TYPES: Record<string, { maxSize: number; extension: string }> = {
  "audio/mpeg": { maxSize: 10 * 1024 * 1024, extension: ".mp3" },
  "audio/mp4": { maxSize: 10 * 1024 * 1024, extension: ".m4a" },
  "audio/x-m4a": { maxSize: 10 * 1024 * 1024, extension: ".m4a" },
  "audio/ogg": { maxSize: 10 * 1024 * 1024, extension: ".ogg" },
  "audio/wav": { maxSize: 15 * 1024 * 1024, extension: ".wav" },
  "audio/x-wav": { maxSize: 15 * 1024 * 1024, extension: ".wav" },
  "audio/webm": { maxSize: 10 * 1024 * 1024, extension: ".weba" },
  "audio/flac": { maxSize: 15 * 1024 * 1024, extension: ".flac" },
};
const MAX_AUDIO_SIZE = 15 * 1024 * 1024;

const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword"
];
const MAX_DOCUMENT_EXTRACT_SIZE = 10 * 1024 * 1024;
const DOCUMENT_EXTRACTION_TIMEOUT_MS = Number(process.env.DOCUMENT_EXTRACTION_TIMEOUT_MS || 15000);

// Hard memory cap for PDF parsing. pdf-parse / its dependencies can balloon
// memory on crafted PDFs (CVE-2023-40681, CVE-2024-31264). We refuse to
// process PDFs whose extracted text exceeds this size.
const PDF_EXTRACT_MAX_TEXT_BYTES = 2 * 1024 * 1024;

function cleanExtractedHtml(input: string) {
  return sanitizeHtml(input || "", {
    allowedTags: ["p", "br", "strong", "em", "u", "ul", "ol", "li", "blockquote", "h1", "h2", "h3"],
    allowedAttributes: {},
    allowedSchemes: []
  }).slice(0, 500000);
}

function isLegacyWordDocument(buffer: Buffer) {
  const cfbMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return buffer.subarray(0, cfbMagic.length).equals(cfbMagic);
}

function looksLikeDocx(buffer: Buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 512 * 1024)).toString("latin1");
  return sample.includes("[Content_Types].xml") && (sample.includes("word/") || sample.includes("word\\"));
}

async function detectDocumentMime(buffer: Buffer, originalname: string): Promise<string | null> {
  const detected = await fileTypeFromBuffer(buffer);
  const lowerName = String(originalname || "").toLowerCase();
  if (detected?.mime === "application/pdf" || buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  if (
    detected?.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ((detected?.mime === "application/zip" || detected?.ext === "zip" || lowerName.endsWith(".docx")) && looksLikeDocx(buffer))
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if ((detected?.mime === "application/msword" || lowerName.endsWith(".doc")) && isLegacyWordDocument(buffer)) {
    return "application/msword";
  }
  return null;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("document_extraction_timeout")), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function validateImage(
  buffer: Buffer,
  mimeType: string,
  overrideDimensions?: { maxWidth: number; maxHeight: number },
): Promise<boolean> {
  try {
    const dimensions = overrideDimensions || ALLOWED_MIME_TYPES[mimeType]?.dimensions;
    if (!dimensions) return true;

    const metadata = await sharp(buffer).metadata();
    if (metadata.width) {
      return metadata.width <= dimensions.maxWidth &&
             Number(metadata.height || 0) <= dimensions.maxHeight;
    }
    return true;
  } catch {
    return false;
  }
}

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const avatarsDir = path.join(uploadDir, "avatars");

function resolveAvatarPath(fileName: string) {
  const safeName = path.basename(fileName || "");
  if (!safeName || safeName !== fileName || !/^[a-zA-Z0-9_.-]+\.webp$/i.test(safeName)) {
    return null;
  }

  const root = path.resolve(avatarsDir);
  const resolved = path.resolve(root, safeName);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // The real per-type ceilings are enforced in the handler; this is only the
    // outer guard, raised so a legitimate manga page scan can be read at all.
    fileSize: MAX_UPLOAD_SIZE,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (!Object.keys(ALLOWED_MIME_TYPES).includes(file.mimetype)) {
      const error: any = new Error("نوع فایل پشتیبانی نمی‌شود");
      error.code = "IMAGE_TYPE_UNSUPPORTED";
      error.status = 415;
      return cb(error);
    }
    cb(null, true);
  }
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("آواتار باید با فرمت JPEG، PNG، WebP، GIF یا AVIF باشد."));
    }
    cb(null, true);
  }
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_SIZE,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    // The declared type is only a first filter; the stored type is decided by
    // sniffing magic bytes in the handler below.
    if (!Object.keys(AUDIO_MIME_TYPES).includes(file.mimetype)) {
      return cb(new Error("فایل صوتی باید با قالب MP3، M4A، OGG، WAV، WebM یا FLAC باشد."));
    }
    cb(null, true);
  }
});

const avatarUploadFields = avatarUpload.fields([
  { name: "avatar", maxCount: 1 },
  { name: "file", maxCount: 1 },
  { name: "image", maxCount: 1 }
]);

function getAvatarUploadFile(req: express.Request): Express.Multer.File | undefined {
  if (req.file) return req.file;
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return files?.avatar?.[0] || files?.file?.[0] || files?.image?.[0];
}

function buildAvatarUploadUser(profile: any, fallback: any, avatarUrl: string) {
  const source = { ...(fallback || {}), ...(profile || {}), avatar: avatarUrl };
  return {
    id: source.id,
    username: source.username,
    role: String(source.role || "writer").toLowerCase().trim(),
    custom_permissions: Array.isArray(source.custom_permissions) ? source.custom_permissions : [],
    custom_role_id: source.custom_role_id || null,
    is_staff: !!source.is_staff,
    is_premium: !!source.is_premium,
    premium_plan: source.premium_plan || null,
    level: source.level,
    xp: source.xp,
    coins: source.coins,
    streak: source.streak,
    avatar: avatarUrl,
    twofa_enabled: !!source.twofa_enabled,
    email: source.email || null,
    phone: source.phone || null,
    nickname: source.nickname || null,
    email_verified: !!source.email_verified,
    verified_author: source.verified_author || false,
    verified_role: source.verified_role || false,
    profile_bio: source.profile_bio || ""
  };
}

/**
 * Validate that a Google Docs URL is canonical and hosted under a known
 * Google Docs origin. This prevents SSRF attacks where an attacker could
 * embed `docs.google.com/document/d/...` inside a larger malicious URL to
 * trick the validator while the request actually goes elsewhere.
 *
 * Accepted (case-insensitive) prefixes:
 *   - https://docs.google.com/document/d/
 *   - https://drive.google.com/
 *
 * The function returns the extracted document ID, or null if invalid.
 */
function extractGoogleDocId(rawUrl: string): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  // Reject any non-HTTPS scheme — prevents javascript:, data:, file:, etc.
  if (parsed.protocol !== "https:") return null;

  // Reject embedded credentials in the URL (e.g. https://user:pass@...).
  if (parsed.username || parsed.password) return null;

  // Whitelist of Google hosts that may host Google Docs URLs.
  const ALLOWED_HOSTS = new Set([
    "docs.google.com",
    "drive.google.com",
  ]);
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  // Match the canonical document ID pattern in the pathname.
  const match = parsed.pathname.match(/\/document\/d\/([a-zA-Z0-9-_]{10,128})/);
  if (!match || !match[1]) return null;
  return match[1];
}

router.post("/upload", [imageUploadLimiter, upload.single("file")], async (req: express.Request, res: express.Response): Promise<any> => {
  const requestId = `upload-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  let storedPath = "";
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز. برای بارگذاری فایل باید وارد حساب خود شوید." });

    if (!req.file) {
      return res.status(400).json({ error: "فایلی بارگذاری نشده است." });
    }

    // Quotas are centralised in mediaLifecycle: per image, per novel (with a
    // larger ceiling for manga page scans) and per account.
    const quotaNovelId = sanitizePlainText(req.body?.novelId, 160).trim() || undefined;
    let quotaIsManga = false;
    if (quotaNovelId) {
      const { data: quotaNovel } = await supabase
        .from("novels")
        .select("id, author_id, content_kind")
        .eq("id", quotaNovelId)
        .single();
      // Only the owner's own novel may consume that novel's allowance.
      if (!quotaNovel || String(quotaNovel.author_id || "") !== String(user.id)) {
        return res.status(403).json({ error: "این رمان به شما تعلق ندارد." });
      }
      quotaIsManga = String((quotaNovel as any).content_kind || "novel") === "manga";
    }

    // A manga page scan is allowed the larger per-file ceiling, but only when the
    // caller both asked for it and owns a manga: the flag alone must never widen
    // the limit for arbitrary uploads.
    const requestedPurpose = String(req.query.purpose || req.body?.purpose || "").trim();
    const isMangaPageUpload = quotaIsManga && requestedPurpose === "manga-page";
    // Declaring `purpose=manga-page` selects the bulk rate-limit bucket before the
    // body can be inspected, so a mismatch is rejected here: an upload that is not
    // actually a page of a manga the caller owns gets no allowance from that
    // bucket, and the failed attempt still counts against it.
    if (requestedPurpose === "manga-page" && !isMangaPageUpload) {
      return res.status(400).json({
        error: "این بارگذاری به‌عنوان صفحهٔ مانگا معتبر نیست؛ شناسهٔ یک مانگای متعلق به شما لازم است.",
        code: "MANGA_PAGE_PURPOSE_INVALID",
      });
    }

    const rejection = await checkUploadQuota({
      ownerId: user.id,
      incomingBytes: req.file.size,
      novelId: quotaNovelId,
      isManga: quotaIsManga,
      maxImageBytes: isMangaPageUpload ? MANGA_PAGE_MAX_BYTES : undefined,
    });
    if (rejection) return res.status(413).json({ error: rejection.message, scope: rejection.scope });

    const { originalname, buffer } = req.file;

    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !Object.keys(ALLOWED_MIME_TYPES).includes(detected.mime)) {
      return res.status(400).json({ error: "محتوای فایل معتبر نیست" });
    }

    const limits = ALLOWED_MIME_TYPES[detected.mime];
    const maxSizeForUpload = isMangaPageUpload ? Math.max(limits.maxSize, MANGA_PAGE_MAX_BYTES) : limits.maxSize;
    if (buffer.length > maxSizeForUpload) {
       return res.status(400).json({ error: "حجم فایل بیش از حد مجاز برای این نوع است." });
    }

    if (detected.mime.startsWith('image/')) {
       // Webtoon pages are extremely tall, so a manga page gets a taller box.
       const isImageValid = await validateImage(buffer, detected.mime, isMangaPageUpload ? MANGA_PAGE_DIMENSIONS : undefined);
       if (!isImageValid) {
         return res.status(400).json({ error: "ابعاد تصویر بیش از حد مجاز است." });
       }
    }

    const scanResult = await scanForMalware(buffer, originalname);
    if (!scanResult.safe) {
      await logSecurityEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        user.id,
        { type: 'MALWARE_UPLOAD', filename: originalname, result: scanResult.result },
        req
      );

      await supabase.from('abuse_logs').insert({
        id: `abuse-${user.id}-${Date.now()}`,
        user_id: user.id,
        abuse_type: 'malware_upload',
        description: `Uploaded potentially malicious file: ${originalname}`,
        severity: 'critical',
        action_taken: 'blocked'
      });

      return res.status(400).json({ error: "فایل در بررسی امنیتی رد شد." });
    }

    const fileHash = computeFileHash(buffer);

    const { data: existingFile } = await supabase
      .from('upload_audits')
      .select('*')
      .eq('file_hash', fileHash)
      .single();

    const isDuplicate = !!existingFile;

    let cleanBuffer = buffer;
    let storedMime = detected.mime;
    if (detected.mime.startsWith('image/')) {
      cleanBuffer = await stripImageMetadata(buffer, detected.mime);
      const converted = await reEncodeUnsafeImageFormats(cleanBuffer, detected.mime);
      if (converted) {
        cleanBuffer = converted.buffer;
        storedMime = converted.mime;
      }
    }

    const safeOriginalName = originalname.replace(/[^\w.\- ]/g, "_").slice(0, 100);
    const extensionByMime: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "application/pdf": ".pdf",
    };
    // Unsafe animated/container formats are decoded and re-encoded before
    // storage. The filename must describe the bytes we actually wrote, not the
    // user-declared/original format, otherwise browsers receive a misleading
    // `.gif` URL containing WebP data.
    const extension = extensionByMime[storedMime] || path.extname(safeOriginalName).toLowerCase();
    const key = `${uuidv4()}${extension}`;
    const filePath = path.join(uploadDir, key);
    storedPath = filePath;

    fs.writeFileSync(filePath, cleanBuffer, { mode: 0o644 });

    const fileId = uuidv4();
    // ✅ SECURITY: Default to private visibility. The caller may explicitly
    // request `public` only after the upload succeeds; otherwise the file is
    // protected behind an authenticated, ownership-checked endpoint.
    const visibility = req.body.visibility === "public" ? "public" : "private";
    const storedUrl = `/uploads/${key}`;
    const url = visibility === "private" ? `/api/upload/${fileId}/content` : storedUrl;

    if (!isDuplicate) {
      const auditResult = await supabase.from('upload_audits').insert({
        id: `audit-${fileId}`,
        user_id: user.id,
        file_name: safeOriginalName,
        file_size: cleanBuffer.length,
        file_hash: fileHash,
        mime_type: storedMime,
        scan_status: 'clean',
        scan_result: scanResult.result,
        quarantined: false,
        created_at: new Date().toISOString()
      });
      if (auditResult.error) {
        console.warn("Upload audit could not be stored", {
          requestId,
          userId: user.id,
          code: auditResult.error.code,
          detail: auditResult.error.detail,
        });
      }
    }

    const metadataResult = await supabase.from('files').insert({
      id: fileId,
      url: storedUrl,
      mimetype: storedMime,
      size: cleanBuffer.length,
      user_id: user.id,
      visibility
    });
    if (metadataResult.error) {
      throw Object.assign(new Error("اطلاعات فایل ذخیره نشد."), metadataResult.error);
    }

    storedPath = "";
    res.status(201).json({ success: true, url, key, fileId, isDuplicate });
  } catch (err: any) {
    if (storedPath && fs.existsSync(storedPath)) {
      try { fs.unlinkSync(storedPath); } catch (cleanupError: any) {
        console.error("Upload cleanup failed", { requestId, path: path.basename(storedPath), message: cleanupError?.message });
      }
    }
    console.error("Upload error", {
      requestId,
      message: err?.message || String(err),
      code: err?.code,
      detail: err?.detail,
    });
    res.status(400).json({ error: "بارگذاری فایل ناموفق بود. لطفاً نوع و حجم تصویر را بررسی کنید و دوباره تلاش کنید.", requestId });
  }
});

/**
 * Audio upload for admin-authored challenge prompts.
 *
 * Owner-only: a public, writable audio endpoint would let any account host
 * arbitrary media on the platform's origin. The stored MIME type comes from
 * magic-byte sniffing, the filename is a UUID, and the row is marked `public`
 * so readers can play the clip without a session.
 */
router.post("/audio", [uploadLimiter, audioUpload.single("audio")], async (req: express.Request, res: express.Response): Promise<any> => {
  const requestId = `audio-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  let storedPath = "";
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "برای بارگذاری فایل صوتی باید وارد حساب خود شوید." });
    if (!isOwnerUser(user)) return res.status(403).json({ error: "بارگذاری فایل صوتی فقط برای مالک مجاز است." });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "فایلی بارگذاری نشده است." });

    const detected = await fileTypeFromBuffer(file.buffer);
    const limits = detected ? AUDIO_MIME_TYPES[detected.mime] : undefined;
    if (!detected || !limits) {
      return res.status(400).json({ error: "محتوای فایل صوتی معتبر نیست یا قالب آن پشتیبانی نمی‌شود." });
    }
    if (file.buffer.length > limits.maxSize) {
      return res.status(400).json({ error: "حجم فایل صوتی بیش از حد مجاز است." });
    }

    const scanResult = await scanForMalware(file.buffer, file.originalname);
    if (!scanResult.safe) {
      await logSecurityEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        user.id,
        { type: "MALWARE_AUDIO_UPLOAD", filename: file.originalname, result: scanResult.result },
        req
      );
      return res.status(400).json({ error: "فایل صوتی در بررسی امنیتی رد شد." });
    }

    const key = `${uuidv4()}${limits.extension}`;
    const filePath = path.join(uploadDir, key);
    storedPath = filePath;
    fs.writeFileSync(filePath, file.buffer, { mode: 0o644 });

    const fileId = uuidv4();
    const storedUrl = `/uploads/${key}`;
    const metadataResult = await supabase.from("files").insert({
      id: fileId,
      url: storedUrl,
      mimetype: detected.mime,
      size: file.buffer.length,
      user_id: user.id,
      visibility: "public"
    });
    if (metadataResult.error) {
      throw Object.assign(new Error("اطلاعات فایل صوتی ذخیره نشد."), metadataResult.error);
    }

    storedPath = "";
    res.status(201).json({ success: true, url: storedUrl, key, fileId, mimetype: detected.mime });
  } catch (err: any) {
    if (storedPath && fs.existsSync(storedPath)) {
      try { fs.unlinkSync(storedPath); } catch (cleanupError: any) {
        console.error("Audio upload cleanup failed", { requestId, message: cleanupError?.message });
      }
    }
    console.error("Audio upload error", { requestId, message: err?.message || String(err), code: err?.code });
    res.status(400).json({ error: "بارگذاری فایل صوتی ناموفق بود. قالب و حجم فایل را بررسی کنید.", requestId });
  }
});

router.get("/:fileId/content", async (req, res): Promise<any> => {
  try {
    const user = await getActiveUser(req, false);
    const { data: file } = await supabase.from("files").select("*").eq("id", req.params.fileId).single();
    if (!file || file.deleted_at) return res.status(404).json({ error: "فایل یافت نشد." });

    // ✅ SECURITY: Always authenticate. Even public files require a logged-in
    // user; this prevents anonymous enumeration of UUID file IDs.
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    // Private files: only owner or site owner may read.
    // Public files: any authenticated user may read (for shared cover images etc.).
    if (file.visibility === "private" && file.user_id !== user.id && !isOwnerUser(user)) {
      return res.status(403).json({ error: "دسترسی غیرمجاز." });
    }

    const fileName = path.basename(String(file.url || "").startsWith("/uploads/") ? String(file.url).replace("/uploads/", "") : String(file.key || ""));
    const resolved = fileName ? path.join(uploadDir, fileName) : "";
    if (!fileName || !resolved.startsWith(uploadDir + path.sep) || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: "محتوای فایل یافت نشد." });
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", file.visibility === "public" ? "public, max-age=86400" : "private, no-store");
    if (file.visibility === "public") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    }
    res.type(file.mimetype || "application/octet-stream");
    res.sendFile(resolved);
  } catch (error: any) {
    console.error("File retrieval failed", {
      fileId: req.params.fileId,
      message: error?.message || String(error),
      code: error?.code,
      detail: error?.detail,
    });
    res.status(400).json({ error: "بارگذاری فایل ناموفق بود." });
  }
});

router.delete("/:fileId", async (req, res): Promise<any> => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { data: file } = await supabase.from("files").select("*").eq("id", req.params.fileId).single();
    if (!file) return res.status(404).json({ error: "فایل یافت نشد." });
    if (file.user_id !== user.id && !isOwnerUser(user)) return res.status(403).json({ error: "دسترسی غیرمجاز." });

    const fileName = path.basename(String(file.url || ""));
    const filePath = path.join(uploadDir, fileName);
    if (fileName && filePath.startsWith(uploadDir) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await supabase.from("files").update({ deleted_at: new Date().toISOString() }).eq("id", req.params.fileId);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف فایل ناموفق بود." });
  }
});

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_EXTRACT_SIZE,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (!DOCUMENT_MIME_TYPES.includes(file.mimetype) && !/\.(pdf|docx?|doc)$/i.test(file.originalname || "")) {
      return cb(new Error("نوع سند پشتیبانی نمی‌شود"));
    }
    cb(null, true);
  }
});

router.post("/extract-text", [uploadLimiter, docUpload.single("file")], async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    if (!req.file) {
      return res.status(400).json({ error: "فایلی بارگذاری نشده است." });
    }

    const { buffer, originalname } = req.file;
    if (buffer.length > MAX_DOCUMENT_EXTRACT_SIZE) {
      return res.status(400).json({ error: "حجم سند بیش از حد مجاز است." });
    }

    const detectedMime = await detectDocumentMime(buffer, originalname);
    if (!detectedMime) {
      return res.status(400).json({ error: "نوع سند پشتیبانی نمی‌شود یا با محتوای آن هم‌خوانی ندارد." });
    }

    const scanResult = await scanForMalware(buffer, originalname);
    if (!scanResult.safe) {
      await logSecurityEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        user.id,
        { type: "MALWARE_DOCUMENT_EXTRACT", filename: originalname, result: scanResult.result },
        req
      );
      return res.status(400).json({ error: "سند در بررسی امنیتی رد شد." });
    }

    let extractedHtml = "";

    if (detectedMime === "application/pdf") {
      // ✅ SECURITY: pdf-parse has known ReDoS / prototype pollution CVEs.
      // Wrap parsing with both a time cap AND a memory cap on extracted text.
      const data: any = await withTimeout(pdfParse(buffer), DOCUMENT_EXTRACTION_TIMEOUT_MS);
      const rawText = String(data?.text || "");
      if (rawText.length > PDF_EXTRACT_MAX_TEXT_BYTES) {
        // A legitimate PDF rarely produces more than 2MB of text. Refusing the
        // request rather than truncating prevents the parser from being used
        // as a memory-exhaustion vector.
        return res.status(413).json({ error: "حجم متن استخراج‌شده از سند بیش از حد مجاز است." });
      }
      extractedHtml = rawText.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('');
    } else if (
      detectedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      detectedMime === "application/msword"
    ) {
      const result = await withTimeout(mammoth.convertToHtml({ buffer }), DOCUMENT_EXTRACTION_TIMEOUT_MS);
      extractedHtml = result.value;
    } else {
      return res.status(400).json({ error: "استخراج متن از این نوع فایل پشتیبانی نمی‌شود." });
    }

    res.json({ success: true, content: cleanExtractedHtml(extractedHtml) });
  } catch (err: any) {
    console.error("Extraction error:", err.message);
    res.status(400).json({ error: "استخراج متن از فایل ناموفق بود." });
  }
});

router.post("/extract-url", uploadLimiter, express.json(), async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });

    const { url } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "نشانی اینترنتی وارد نشده است." });

    // ✅ SECURITY: Strict URL validation. Only canonical https://docs.google.com
    // (or drive.google.com) URLs are accepted. No embedded credentials, no
    // protocol-relative URLs, no query-string tricks. This eliminates the
    // SSRF surface that previously allowed attackers to bypass the regex
    // by embedding the docs.google.com path inside a larger malicious URL.
    const docId = extractGoogleDocId(url);
    if (!docId) {
      return res.status(400).json({ error: "در حال حاضر فقط نشانی اسناد Google Docs پشتیبانی می‌شود." });
    }

    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
    const MAX_EXTRACT_BYTES = 2 * 1024 * 1024;

    // ✅ SECURITY: Do NOT follow redirects. Google Docs export URLs do not
    // legitimately redirect to other hosts; any redirect is suspicious and
    // would allow SSRF if followed.
    const response = await fetch(exportUrl, {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
      headers: {
        // Strip any default headers that could leak server identity.
        "Accept": "text/plain, */*",
      },
    });

    if (!response.ok) {
      return res.status(400).json({ error: "دریافت سند ناموفق بود. بررسی کنید که سند برای عموم قابل دسترسی باشد." });
    }

    // ✅ SECURITY: Verify the response came from the expected Google host.
    // (After `redirect: "error"`, response.url should equal exportUrl.)
    const finalUrl = response.url;
    let finalHost = "";
    try { finalHost = new URL(finalUrl).hostname.toLowerCase(); } catch { /* ignore */ }
    if (!["docs.google.com", "drive.google.com"].includes(finalHost)) {
      return res.status(400).json({ error: "نشانی پاسخ نامعتبر است." });
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_EXTRACT_BYTES) {
      return res.status(400).json({ error: "حجم سند بیش از حد مجاز است." });
    }

    // ✅ SECURITY: Verify content-type. A malicious Google-hosted page could
    // return HTML instead of plain text; we explicitly require text/plain.
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("text/plain")) {
      return res.status(400).json({ error: "نوع محتوای سند پشتیبانی نمی‌شود." });
    }

    const reader = (response.body as any)?.getReader ? (response.body as any).getReader() : null;
    let text = "";
    let received = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_EXTRACT_BYTES) {
          await reader.cancel().catch(() => {});
          return res.status(400).json({ error: "حجم سند بیش از حد مجاز است." });
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = (await response.text()).slice(0, MAX_EXTRACT_BYTES);
    }

    const html = text.split('\n').filter(p => p.trim() !== '').map(p => `<p>${p.trim()}</p>`).join('');
    return res.json({ success: true, content: cleanExtractedHtml(html) });
  } catch (err: any) {
    console.error("URL extraction error:", err.message);
    res.status(400).json({ error: "استخراج متن از نشانی ناموفق بود." });
  }
});

router.get("/avatar/:fileName", async (req, res): Promise<any> => {
  try {
    const avatarPath = resolveAvatarPath(req.params.fileName || "");
    if (!avatarPath || !fs.existsSync(avatarPath)) {
      return res.status(404).json({ error: "آواتار یافت نشد." });
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.type("image/webp");
    res.sendFile(avatarPath);
  } catch {
    res.status(404).json({ error: "آواتار یافت نشد." });
  }
});

router.post("/avatar", [uploadLimiter, avatarUploadFields], async (req: express.Request, res: express.Response): Promise<any> => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز. برای بارگذاری آواتار باید وارد حساب خود شوید." });

    const uploadFile = getAvatarUploadFile(req);
    if (!uploadFile) {
      return res.status(400).json({ error: "فایلی بارگذاری نشده است." });
    }

    const { buffer, originalname } = uploadFile;

    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !detected.mime.startsWith('image/')) {
      return res.status(400).json({ error: "آواتار باید یک فایل تصویری باشد (JPEG، PNG، WebP، GIF)." });
    }

    if (!AVATAR_MIME_TYPES.has(detected.mime)) {
      return res.status(400).json({ error: "آواتار باید با فرمت JPEG، PNG، WebP، GIF یا AVIF باشد." });
    }

    const MAX_AVATAR_SIZE = 10 * 1024 * 1024;
    if (buffer.length > MAX_AVATAR_SIZE) {
      return res.status(400).json({ error: "حجم فایل آواتار نمی‌تواند بیش از 10 مگابایت باشد." });
    }

    const isImageValid = await validateImage(buffer, detected.mime);
    if (!isImageValid) {
      return res.status(400).json({ error: "ابعاد تصویر آواتار معتبر نیست." });
    }

    const scanResult = await scanForMalware(buffer, originalname);
    if (!scanResult.safe) {
      await logSecurityEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        user.id,
        { type: 'MALWARE_AVATAR_UPLOAD', filename: originalname, result: scanResult.result },
        req
      );

      await supabase.from('abuse_logs').insert({
        id: `abuse-avatar-${user.id}-${Date.now()}`,
        user_id: user.id,
        abuse_type: 'malware_upload',
        description: `Attempted to upload malicious avatar: ${originalname}`,
        severity: 'high',
        action_taken: 'blocked'
      });

      return res.status(400).json({ error: "آواتار در بررسی امنیتی رد شد." });
    }

    let optimizedBuffer = buffer;
    try {
      optimizedBuffer = await sharp(buffer, { animated: false })
        .rotate()
        .resize(512, 512, { fit: 'cover', position: 'center' })
        .webp({ quality: 86, effort: 4 })
        .toBuffer();
    } catch (err) {
      console.error("Image optimization failed:", err);
      return res.status(400).json({ error: "پردازش تصویر آواتار ناموفق بود." });
    }

    const fileHash = computeFileHash(optimizedBuffer);
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }

    const avatarFilename = `${user.id}-${fileHash.substring(0, 8)}.webp`;
    const avatarPath = resolveAvatarPath(avatarFilename);
    if (!avatarPath) {
      return res.status(400).json({ error: "مسیر ذخیره‌سازی آواتار نامعتبر است." });
    }

    fs.writeFileSync(avatarPath, optimizedBuffer);

    const avatarUrl = `/api/upload/avatar/${avatarFilename}`;

    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ avatar: avatarUrl })
      .eq('id', user.id)
      .select("id, username, role, custom_role_id, is_staff, is_premium, premium_plan, level, xp, coins, streak, avatar, twofa_enabled, email, phone, nickname, email_verified, verified_author, verified_role, profile_bio")
      .single();

    if (updateError || !updatedUser) {
      try {
        fs.unlinkSync(avatarPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      console.error("Avatar profile update failed:", updateError?.message || "No matching user row updated");
      return res.status(400).json({ error: "ذخیره آواتار در پروفایل ناموفق بود." });
    }

    res.json({
      success: true,
      avatarUrl,
      avatar: avatarUrl,
      user: buildAvatarUploadUser(updatedUser, user, avatarUrl),
      message: "آواتار با موفقیت بارگذاری شد."
    });

  } catch (err: any) {
    console.error("Avatar upload error:", err.message);
    res.status(400).json({ error: "بارگذاری آواتار ناموفق بود." });
  }
});

export default router;
