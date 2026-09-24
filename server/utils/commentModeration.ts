import { isIP } from "node:net";
import { db } from "../postgres";
import { decrypt, encrypt } from "./encryption";

export const COMMENT_MODERATION_SETTING_KEY = "comment_moderation_config";
export const DEFAULT_COMMENT_MODERATION_ENDPOINT = "https://nemo.inteshopa.workers.dev/";
export const HIDDEN_API_KEY = "***HIDDEN***";

export type CommentModerationMode = "manual" | "automatic";
export type CommentModerationVerdict = "ALLOW" | "BLOCK";

export interface CommentModerationConfig {
  mode: CommentModerationMode;
  endpoint: string;
  apiKey: string;
  apiKeyConfigured: boolean;
}

function parseSettingValue(value: unknown): any {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

export function validateModerationEndpoint(input: unknown): string {
  const value = String(input || "").trim();
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("آدرس سرویس نظارت معتبر نیست."); }
  if (parsed.protocol !== "https:") throw new Error("سرویس نظارت باید از HTTPS استفاده کند.");
  if (parsed.username || parsed.password) throw new Error("قرار دادن اطلاعات ورود داخل آدرس مجاز نیست.");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("آدرس محلی برای سرویس نظارت مجاز نیست.");
  }
  const ipType = isIP(hostname);
  if (ipType === 4) {
    const parts = hostname.split(".").map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) {
      throw new Error("آدرس شبکه خصوصی برای سرویس نظارت مجاز نیست.");
    }
  }
  if (ipType === 6 && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80"))) {
    throw new Error("آدرس شبکه خصوصی برای سرویس نظارت مجاز نیست.");
  }
  return parsed.toString();
}

export async function loadCommentModerationConfig(): Promise<CommentModerationConfig> {
  const row = (await db.query("SELECT setting_value FROM settings WHERE setting_key=$1 LIMIT 1", [COMMENT_MODERATION_SETTING_KEY])).rows[0];
  const stored = parseSettingValue(row?.setting_value);
  const encryptedKey = String(stored.encryptedApiKey || "");
  const apiKey = encryptedKey ? (decrypt(encryptedKey) || "") : "";
  return {
    mode: stored.mode === "automatic" ? "automatic" : "manual",
    endpoint: validateModerationEndpoint(stored.endpoint || DEFAULT_COMMENT_MODERATION_ENDPOINT),
    apiKey,
    apiKeyConfigured: !!apiKey,
  };
}

export async function saveCommentModerationConfig(input: { mode?: unknown; endpoint?: unknown; apiKey?: unknown }) {
  const current = await loadCommentModerationConfig();
  const mode: CommentModerationMode = input.mode === "automatic" ? "automatic" : "manual";
  const endpoint = validateModerationEndpoint(input.endpoint || current.endpoint);
  const submittedKey = String(input.apiKey || "").trim();
  const apiKey = !submittedKey || submittedKey === HIDDEN_API_KEY ? current.apiKey : submittedKey;
  if (mode === "automatic" && !apiKey) throw new Error("برای فعال‌سازی تأیید خودکار، کلید API الزامی است.");
  const stored = { mode, endpoint, encryptedApiKey: apiKey ? encrypt(apiKey) : "" };
  await db.query(
    `INSERT INTO settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,timezone('utc'::text,now()))
     ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=EXCLUDED.updated_at`,
    [COMMENT_MODERATION_SETTING_KEY, JSON.stringify(stored)],
  );
  return { mode, endpoint, apiKeyConfigured: !!apiKey };
}

function flattenProviderResponse(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["result", "verdict", "decision", "status", "message", "output", "response"]) {
      if (key in object) return flattenProviderResponse(object[key]);
    }
  }
  return JSON.stringify(value);
}

export function parseCommentModerationVerdict(response: unknown): CommentModerationVerdict {
  const text = flattenProviderResponse(response).toUpperCase();
  const allow = /(^|[^A-Z])ALLOW([^A-Z]|$)/.test(text);
  const block = /(^|[^A-Z])BLOCK([^A-Z]|$)/.test(text);
  if (allow === block) throw new Error("پاسخ سرویس نظارت نامشخص است.");
  return block ? "BLOCK" : "ALLOW";
}

export async function classifyComment(content: string, suppliedConfig?: CommentModerationConfig): Promise<CommentModerationVerdict> {
  const config = suppliedConfig || await loadCommentModerationConfig();
  if (!config.apiKey) throw new Error("کلید API سرویس نظارت تنظیم نشده است.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: String(content || "").slice(0, 5000) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`سرویس نظارت پاسخ HTTP ${response.status} داد.`);
    const raw = (await response.text()).slice(0, 50_000);
    let parsed: unknown = raw;
    try { parsed = JSON.parse(raw); } catch {}
    return parseCommentModerationVerdict(parsed);
  } finally {
    clearTimeout(timeout);
  }
}

export async function moderateNewComment(content: string): Promise<{ status: "pending" | "visible" | "rejected"; source: string; result: string | null }> {
  try {
    const config = await loadCommentModerationConfig();
    if (config.mode !== "automatic" || !config.apiKeyConfigured) return { status: "pending", source: "manual_queue", result: null };
    const verdict = await classifyComment(content, config);
    return { status: verdict === "ALLOW" ? "visible" : "rejected", source: "automatic_ai", result: verdict };
  } catch (error: any) {
    console.warn("Automatic comment moderation deferred", { message: error?.message || "unknown error" });
    return { status: "pending", source: "automatic_error", result: "ERROR" };
  }
}
