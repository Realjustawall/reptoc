import nodemailer from "nodemailer";
import { decrypt } from "./encryption";

let transporter: nodemailer.Transporter | null = null;
const DEFAULT_FROM_EMAIL = "noreply@reptoc.xyz";
const DEFAULT_FROM_NAME = "رپتوک";

export interface SmtpConfig {
  host?: string;
  port?: number | string;
  user?: string;
  pass?: string;
  from?: string;
  secure?: boolean;
  direct?: boolean;
}

export interface MailjetConfig {
  apiKey?: string;
  secretKey?: string;
  from?: string;
  fromName?: string;
}

export interface ResendConfig {
  apiKey?: string;
  from?: string;
  fromName?: string;
}

export type EmailProvider = "smtp" | "mailjet" | "resend";

export interface EmailConfig {
  provider?: EmailProvider | string;
  smtp?: SmtpConfig;
  mailjet?: MailjetConfig;
  resend?: ResendConfig;
}

function hasSmtpConfig(config?: SmtpConfig): boolean {
  return !!(config?.host || process.env.SMTP_HOST) &&
    !!(config?.port || process.env.SMTP_PORT || 587) &&
    !!(config?.user || process.env.SMTP_USER) &&
    !!(config?.pass || process.env.SMTP_PASS);
}

function hasMailjetConfig(config?: MailjetConfig): boolean {
  return !!(config?.apiKey || process.env.MAILJET_API_KEY) &&
    !!(config?.secretKey || process.env.MAILJET_SECRET_KEY);
}

function hasResendConfig(config?: ResendConfig): boolean {
  return !!(config?.apiKey || process.env.RESEND_API_KEY);
}

function normalizeProvider(value: unknown): EmailProvider | undefined {
  const provider = String(value || "").trim().toLowerCase();
  return provider === "smtp" || provider === "mailjet" || provider === "resend" ? provider : undefined;
}

function decryptIfEncrypted(value: unknown): string {
  if (!value) return "";
  const text = String(value);
  return decrypt(text) || text;
}

function normalizeEmailAddress(value: unknown, fallback = DEFAULT_FROM_EMAIL): string {
  const text = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : fallback;
}

function formatNamedEmail(email: string, name: string): string {
  const cleanName = String(name || "").replace(/[<>\r\n"]/g, "").trim();
  return cleanName ? `${cleanName} <${email}>` : email;
}

function emailLogContext(provider: string, details: Record<string, unknown>) {
  return {
    provider,
    ...details,
    apiKey: details.apiKey ? "[configured]" : undefined,
    secretKey: details.secretKey ? "[configured]" : undefined,
    pass: details.pass ? "[configured]" : undefined
  };
}

function describeEmailError(error: any): string {
  if (!error) return "unknown_error";
  const parts = [error.code, error.command, error.responseCode, error.response, error.message].filter(Boolean);
  return parts.length ? parts.join(" | ") : String(error);
}

export function getDefaultFromEmail() {
  return normalizeEmailAddress(process.env.FROM_EMAIL || process.env.RESEND_FROM_EMAIL || process.env.MAILJET_FROM_EMAIL || DEFAULT_FROM_EMAIL);
}

export function prepareEmailConfig(config: EmailConfig = {}): EmailConfig {
  const smtp = config.smtp || {};
  const mailjet = config.mailjet || {};
  const resend = config.resend || {};
  const defaultFrom = getDefaultFromEmail();
  return {
    provider: normalizeProvider(config.provider || process.env.EMAIL_PROVIDER),
    smtp: { ...smtp, pass: decryptIfEncrypted(smtp.pass), from: normalizeEmailAddress(smtp.from || process.env.FROM_EMAIL || defaultFrom) },
    mailjet: { ...mailjet, apiKey: decryptIfEncrypted(mailjet.apiKey), secretKey: decryptIfEncrypted(mailjet.secretKey), from: normalizeEmailAddress(mailjet.from || process.env.MAILJET_FROM_EMAIL || defaultFrom), fromName: String(mailjet.fromName || process.env.MAILJET_FROM_NAME || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME },
    resend: { ...resend, apiKey: decryptIfEncrypted(resend.apiKey), from: normalizeEmailAddress(resend.from || process.env.RESEND_FROM_EMAIL || process.env.FROM_EMAIL || defaultFrom), fromName: String(resend.fromName || process.env.RESEND_FROM_NAME || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME }
  };
}

export function getEmailTransporter(): nodemailer.Transporter {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) throw new Error("SMTP environment variables are not fully configured.");
    transporter = nodemailer.createTransport({ host: SMTP_HOST, port: parseInt(SMTP_PORT, 10), secure: parseInt(SMTP_PORT, 10) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  }
  return transporter;
}

export function getEmailProviderAvailability(config: EmailConfig = {}) {
  const merged = prepareEmailConfig(config);
  const smtp = hasSmtpConfig(merged.smtp);
  const mailjet = hasMailjetConfig(merged.mailjet);
  const resend = hasResendConfig(merged.resend);
  const direct = (merged.smtp as any)?.direct === true || String(process.env.SMTP_DIRECT || "").trim().toLowerCase() === "true";
  return { smtp, mailjet, resend, direct, any: smtp || mailjet || resend || direct };
}

// ✅ SECURITY: Helper functions for email sanitization

const SAFE_EMAIL_RECIPIENT = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function validateEmailRecipient(address: string): boolean {
  if (typeof address !== "string" || address.length > 320) return false;
  if (/[\r\n]/.test(address)) return false;
  return SAFE_EMAIL_RECIPIENT.test(address);
}

function stripHeaderInjection(value: string): string {
  return String(value || "").replace(/[\r\n]/g, " ").slice(0, 998);
}

function sanitizeEmailHtml(html: string): string {
  return String(html || "")
    .replace(/<\s*(script|iframe|object|embed|style|link|meta|base|form)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|style|link|meta|base|form)\b[^>]*\/?\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("(?:javascript:|data:text\/html)[^"]*"|'(?:javascript:|data:text\/html)[^']*')/gi, '$1="#"');
}

export function escapeHtmlForEmail(value: string): string {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/[\r\n]/g, " ").trim();
}

// ✅ SECURITY: sendEmail with recipient validation, header injection prevention, and HTML sanitization

async function sendDirectEmail(from: string, to: string, subject: string, text: string, html: string): Promise<boolean> {
  try {
    const info = await nodemailer.createTransport({ direct: true }).sendMail({ from, to, subject, text, html });
    console.log("[email:direct] Delivered via direct MX delivery", { to, from, subject, messageId: (info as any)?.messageId });
    return true;
  } catch (error) {
    console.error("[email:direct] Direct delivery failed", { to, subject, error: describeEmailError(error) });
    return false;
  }
}

export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!validateEmailRecipient(to)) { console.error("[email] Refused to send: invalid recipient", { to: String(to).slice(0, 80) }); return false; }
  const safeSubject = stripHeaderInjection(subject);
  const safeHtml = html ? sanitizeEmailHtml(html) : undefined;
  const FROM_EMAIL = getDefaultFromEmail();
  const mailer = getEmailTransporter();
  try {
    const info = await mailer.sendMail({ from: FROM_EMAIL, to, subject: safeSubject, text, html: safeHtml });
    console.log("Real Email sent successfully: ", info.messageId);
    return true;
  } catch (error) {
    console.error("[email:smtp:default] Failed to send email", { to, from: FROM_EMAIL, subject: safeSubject, error: describeEmailError(error) });
    return false;
  }
}

export async function sendEmailWithConfig(config: SmtpConfig, to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!validateEmailRecipient(to)) { console.error("[email] Refused to send: invalid recipient", { to: String(to).slice(0, 80) }); return false; }
  const safeSubject = stripHeaderInjection(subject);
  const safeHtml = html ? sanitizeEmailHtml(html) : undefined;
  const host = config.host || process.env.SMTP_HOST;
  const port = Number(config.port || process.env.SMTP_PORT || 587);
  const user = config.user || process.env.SMTP_USER;
  const pass = config.pass || process.env.SMTP_PASS;
  const from = normalizeEmailAddress(config.from || process.env.FROM_EMAIL || getDefaultFromEmail());
  if (!host || !port || !user || !pass || !from) { console.error("[email:smtp] Incomplete SMTP settings", emailLogContext("smtp", { host, port, user: !!user, pass: !!pass, from, to, subject })); throw new Error("SMTP settings are incomplete."); }
  const mailer = nodemailer.createTransport({ host, port, secure: config.secure ?? port === 465, auth: { user, pass } });
  try {
    await mailer.verify();
    const info = await mailer.sendMail({ from, to, subject: safeSubject, text, html: safeHtml });
    console.log("[email:smtp] Email sent successfully", { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, to, from, subject: safeSubject });
    return true;
  } catch (error) {
    console.error("[email:smtp] Failed to send configured SMTP email", { host, port, secure: config.secure ?? port === 465, user, from, to, subject: safeSubject, error: describeEmailError(error) });
    return false;
  }
}

export async function sendMailjetEmail(config: MailjetConfig, to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!validateEmailRecipient(to)) { console.error("[email:mailjet] Refused to send: invalid recipient", { to: String(to).slice(0, 80) }); return false; }
  const safeSubject = stripHeaderInjection(subject);
  const safeHtml = html ? sanitizeEmailHtml(html) : undefined;
  const apiKey = config.apiKey || process.env.MAILJET_API_KEY;
  const secretKey = config.secretKey || process.env.MAILJET_SECRET_KEY;
  const from = normalizeEmailAddress(config.from || process.env.MAILJET_FROM_EMAIL || process.env.FROM_EMAIL || getDefaultFromEmail());
  const fromName = String(config.fromName || process.env.MAILJET_FROM_NAME || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME;
  if (!apiKey || !secretKey || !from) { console.error("[email:mailjet] Incomplete Mailjet settings", emailLogContext("mailjet", { apiKey, secretKey, from, fromName, to, subject })); throw new Error("Mailjet API settings are incomplete."); }
  try {
    const response = await fetch("https://api.mailjet.com/v3.1/send", { method: "POST", headers: { "Authorization": `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}`, "Content-Type": "application/json" }, body: JSON.stringify({ Messages: [{ From: { Email: from, Name: fromName }, To: [{ Email: to }], Subject: safeSubject, TextPart: text, HTMLPart: safeHtml }] }) });
    if (!response.ok) { const body = await response.text().catch(() => ""); console.error("[email:mailjet] Mailjet API rejected email", { status: response.status, statusText: response.statusText, to, from, fromName, subject: safeSubject, body: body.slice(0, 2000) }); return false; }
    const body = await response.json().catch(() => null);
    const messages = Array.isArray(body?.Messages) ? body.Messages : [];
    const failedMessage = messages.find((message: any) => String(message?.Status || "").toLowerCase() !== "success");
    if (failedMessage) { console.error("[email:mailjet] Mailjet accepted request but message failed", { to, from, fromName, subject: safeSubject, message: failedMessage }); return false; }
    console.log("[email:mailjet] Email sent successfully", { to, from, fromName, subject: safeSubject, messages: messages.map((message: any) => ({ status: message?.Status, to: message?.To, errors: message?.Errors })) });
    return true;
  } catch (error) {
    console.error("[email:mailjet] Failed to send Mailjet email", { to, from, fromName, subject: safeSubject, error: describeEmailError(error) });
    return false;
  }
}

export async function sendResendEmail(config: ResendConfig, to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!validateEmailRecipient(to)) { console.error("[email:resend] Refused to send: invalid recipient", { to: String(to).slice(0, 80) }); return false; }
  const safeSubject = stripHeaderInjection(subject);
  const safeHtml = html ? sanitizeEmailHtml(html) : undefined;
  const apiKey = config.apiKey || process.env.RESEND_API_KEY;
  const from = normalizeEmailAddress(config.from || process.env.RESEND_FROM_EMAIL || process.env.FROM_EMAIL || getDefaultFromEmail());
  const fromName = String(config.fromName || process.env.RESEND_FROM_NAME || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME;
  if (!apiKey || !from) { console.error("[email:resend] Incomplete Resend settings", emailLogContext("resend", { apiKey, from, fromName, to, subject })); throw new Error("Resend API settings are incomplete."); }
  try {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "Reptoc/1.0" }, body: JSON.stringify({ from: formatNamedEmail(from, fromName), to, subject: safeSubject, html: safeHtml || `<p>${String(text || "").replace(/\n/g, "<br>")}</p>`, text }) });
    if (!response.ok) { const body = await response.text().catch(() => ""); console.error("[email:resend] Resend API rejected email", { status: response.status, statusText: response.statusText, to, from, fromName, subject: safeSubject, body: body.slice(0, 2000) }); return false; }
    const body = await response.json().catch(() => null);
    console.log("[email:resend] Email sent successfully", { id: body?.id, to, from, fromName, subject: safeSubject });
    return true;
  } catch (error) {
    console.error("[email:resend] Failed to send Resend email", { to, from, fromName, subject: safeSubject, error: describeEmailError(error) });
    return false;
  }
}

export async function sendEmailWithAvailableConfig(config: EmailConfig, to: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!validateEmailRecipient(to)) { console.error("[email] Refused to send: invalid recipient", { to: String(to).slice(0, 80) }); return false; }
  const safeSubject = stripHeaderInjection(subject);
  const safeHtml = html ? sanitizeEmailHtml(html) : undefined;
  const requestedProvider = normalizeProvider(config.provider || process.env.EMAIL_PROVIDER);
  if (requestedProvider === "resend") { return sendResendEmail(config.resend || {}, to, safeSubject, text, safeHtml || ""); }
  if (requestedProvider === "mailjet") { return sendMailjetEmail(config.mailjet || {}, to, safeSubject, text, safeHtml || ""); }
  if (requestedProvider === "smtp") {
    if ((config.smtp as any)?.direct === true && !hasSmtpConfig(config.smtp)) { return sendDirectEmail(config.smtp?.from || process.env.FROM_EMAIL || getDefaultFromEmail(), to, safeSubject, text, safeHtml || ""); }
    return sendEmailWithConfig(config.smtp || {}, to, safeSubject, text, safeHtml || "");
  }
  if (hasResendConfig(config.resend)) { return sendResendEmail(config.resend || {}, to, safeSubject, text, safeHtml || ""); }
  if (hasMailjetConfig(config.mailjet)) { return sendMailjetEmail(config.mailjet || {}, to, safeSubject, text, safeHtml || ""); }
  if (hasSmtpConfig(config.smtp)) { return sendEmailWithConfig(config.smtp || {}, to, safeSubject, text, safeHtml || ""); }
  const directEnabled = (config.smtp as any)?.direct === true || String(process.env.SMTP_DIRECT || "").trim().toLowerCase() === "true";
  if (directEnabled) { return sendDirectEmail(config.smtp?.from || process.env.FROM_EMAIL || getDefaultFromEmail(), to, safeSubject, text, safeHtml || ""); }
  console.error("[email] No complete email configuration is available", { smtp: { host: !!(config.smtp?.host || process.env.SMTP_HOST), port: !!(config.smtp?.port || process.env.SMTP_PORT || 587), user: !!(config.smtp?.user || process.env.SMTP_USER), pass: !!(config.smtp?.pass || process.env.SMTP_PASS) }, mailjet: { apiKey: !!(config.mailjet?.apiKey || process.env.MAILJET_API_KEY), secretKey: !!(config.mailjet?.secretKey || process.env.MAILJET_SECRET_KEY) }, resend: { apiKey: !!(config.resend?.apiKey || process.env.RESEND_API_KEY) } });
  throw new Error("No complete SMTP, Mailjet, or Resend email configuration is available.");
}
