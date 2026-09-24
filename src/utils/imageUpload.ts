export interface ImageUploadResponse {
  success?: boolean;
  url?: string;
  avatar?: string;
  avatarUrl?: string;
  fileId?: string;
  key?: string;
  requestId?: string;
  error?: string;
  user?: Record<string, unknown>;
}

interface UploadImageOptions {
  endpoint?: string;
  fieldName?: string;
  fileName: string;
  csrfToken: string | null;
  timeoutMs?: number;
  /**
   * Extra multipart fields sent alongside the image.
   *
   * Chapter illustrations must be uploaded with `{ visibility: "public" }` so
   * readers can load them from `/uploads/...`; private uploads are only
   * readable by their owner.
   */
  fields?: Record<string, string>;
}

const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif|avif));base64,([a-zA-Z0-9+/=\s]+)$/i;

export function imageDataUrlToBlob(dataUrl: string): Blob {
  const match = IMAGE_DATA_URL.exec(dataUrl);
  if (!match) {
    throw new Error("قالب تصویر آماده‌شده پشتیبانی نمی‌شود.");
  }

  try {
    const binary = globalThis.atob(match[2].replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: match[1].toLowerCase() });
  } catch {
    throw new Error("تصویر آماده‌شده رمزگشایی نشد.");
  }
}

function parseUploadResponse(text: string): ImageUploadResponse {
  if (!text) return {};
  try {
    return JSON.parse(text) as ImageUploadResponse;
  } catch {
    return {};
  }
}

export async function uploadImageBlob(
  blob: Blob,
  {
    endpoint = "/api/files/upload",
    fieldName = "file",
    fileName,
    csrfToken,
    timeoutMs = 60_000,
    fields,
  }: UploadImageOptions,
): Promise<ImageUploadResponse> {
  if (!csrfToken) {
    throw new Error("نشست شما منقضی شده است. پیش از بارگذاری تصویر دوباره وارد شوید.");
  }
  if (!blob.type.startsWith("image/")) {
    throw new Error("لطفاً یک فایل تصویری پشتیبانی‌شده انتخاب کنید.");
  }

  const form = new FormData();
  // Text fields are appended before the binary part so servers that stream the
  // multipart body see them while the upload is still in flight.
  for (const [name, value] of Object.entries(fields || {})) {
    form.append(name, value);
  }
  form.append(fieldName, blob, fileName);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      credentials: "same-origin",
      body: form,
      signal: controller.signal,
    });
    const body = parseUploadResponse(await response.text());
    if (!response.ok) {
      const requestReference = body.requestId ? ` شناسه پیگیری: ${body.requestId}.` : "";
      throw new Error(`${body.error || `بارگذاری تصویر ناموفق بود (HTTP ${response.status}).`}${requestReference}`);
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("زمان بارگذاری تصویر به پایان رسید. اتصال خود را بررسی کنید و دوباره تلاش کنید.");
    }
    if (error instanceof TypeError) {
      throw new Error("ارتباط با سرور تصاویر برقرار نشد. اتصال خود را بررسی کنید و دوباره تلاش کنید.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
