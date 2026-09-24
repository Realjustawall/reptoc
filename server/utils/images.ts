import path from "path";

// Locally served image references. `/api/upload/<id>/content` and
// `/api/files/<id>/content` are the same authenticated endpoint mounted twice,
// so both spellings must be accepted: the upload route returns the former for
// private files and rejecting it silently broke cover and character uploads.
const LOCAL_PUBLIC_IMAGE = /^\/(?:uploads\/(?:avatars\/)?[a-zA-Z0-9_.-]+|api\/upload\/avatar\/[a-zA-Z0-9_.-]+|api\/(?:files|upload)\/[a-zA-Z0-9_.-]+\/content|api\/novels\/[^/]+\/cover)$/;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=]+$/;

export function normalizeStoredImageReference(
  value: unknown,
  options: { allowLegacyDataUrl?: boolean; allowEmpty?: boolean } = {},
): string {
  const raw = String(value || "").trim();
  if (!raw && options.allowEmpty !== false) return "";
  if (/^blob:/i.test(raw)) throw new Error("نشانی‌های موقت مرورگر (blob:) قابل ذخیره نیستند؛ ابتدا تصویر را بارگذاری کنید.");
  if (LOCAL_PUBLIC_IMAGE.test(raw)) return raw;
  if (options.allowLegacyDataUrl && IMAGE_DATA_URL.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("نشانی تصویر باید مسیر یک تصویر بارگذاری‌شده یا یک نشانی HTTPS معتبر باشد.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("پروتکل نشانی تصویر پشتیبانی نمی‌شود.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    url.protocol = "https:";
  }
  return url.href;
}

export function publicUploadFileName(value: unknown): string | null {
  const raw = String(value || "");
  if (!raw.startsWith("/uploads/")) return null;
  const name = path.basename(raw.slice("/uploads/".length));
  return name && `/uploads/${name}` === raw ? name : null;
}
