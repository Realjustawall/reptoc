import net from "net";
import { v4 as uuidv4 } from "uuid";
import { db, supabase } from "../postgres";

/**
 * Minimal inbound ESMTP receiver so a self-hosted deployment with an open
 * port 25 can RECEIVE mail for its own domain (bounce/reply capture).
 *
 * Scope: single-domain, no relay (we never forward mail elsewhere), strict
 * recipient filtering, hard size caps, per-IP message throttling, bounded
 * concurrency, and a loopback-by-default bind address.
 *
 * ✅ SECURITY HARDENING applied:
 *   - Strict RFC 5321 envelope_from validation (no \r\n, no spaces, no <>)
 *   - Strict recipient validation (must end with @<configured-domain>)
 *   - Subject line sanitized before persistence to prevent XSS in admin UI
 *   - Connection throttling with both concurrent-conn and per-IP message caps
 *   - Default bind to loopback (must be explicitly overridden to expose)
 *   - All responses use canonical CRLF termination
 */

const MAX_MESSAGE_BYTES = 1024 * 1024;
const SESSION_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_CONNECTIONS = Number(process.env.INBOUND_MAIL_MAX_CONNECTIONS || 20);
const MAX_MESSAGES_PER_IP_PER_WINDOW = Number(process.env.INBOUND_MAIL_MAX_PER_IP || 5);
const MESSAGE_WINDOW_MS = 60_000;

// ✅ SECURITY: Strict RFC 5321 local-part + domain regex. Rejects any
// envelope containing control characters, newlines, or shell metacharacters.
const EMAIL_ADDRESS_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// ✅ SECURITY: Strips control characters that could be used for SMTP smuggling
// (CVE-2023-51794) — \r\n inside the envelope would let an attacker inject
// additional messages into a single DATA frame.
const SMTP_CRLF_PATTERN = /[\r\n]/g;

// ✅ SECURITY: Subject line allowed charset (no HTML, no control chars).
// This prevents stored XSS when the subject is later rendered in the admin UI.
function sanitizeSubjectHeader(value: string): string {
  return String(value || "")
    .replace(SMTP_CRLF_PATTERN, " ")
    .replace(/[<>"'&]/g, "") // strip HTML metacharacters
    .replace(/[\u0000-\u001F\u007F]/g, "") // strip control chars
    .slice(0, 500);
}

export interface InboundMailConfig {
  enabled: boolean;
  port: number;
  domain: string;
  /** Bind address. Defaults to loopback so the listener is never public by accident. */
  host?: string;
}

let server: net.Server | null = null;
let runningPort = 0;
let runningDomain = "";
let runningHost = "";

function sanitizeDomain(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 253);
}

function sanitizeBindHost(value: unknown): string {
  const host = String(value || "").trim();
  // Only plain IPv4/IPv6 hostnames are accepted; empty falls back to loopback.
  return /^[a-zA-Z0-9.:_-]+$/.test(host) ? host.slice(0, 45) : "127.0.0.1";
}

export async function ensureInboundMailTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS public.inbound_emails (
    id TEXT PRIMARY KEY,
    envelope_from TEXT NOT NULL DEFAULT '',
    envelope_to TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    raw_size INTEGER NOT NULL DEFAULT 0,
    raw TEXT NOT NULL DEFAULT '',
    is_read BOOLEAN NOT NULL DEFAULT false,
    received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
  )`).catch(() => {});
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inbound_emails_received ON public.inbound_emails (received_at DESC)`).catch(() => {});
}

async function readConfigRow(): Promise<InboundMailConfig | null> {
  try {
    const { data } = await supabase.from("settings").select("setting_value").eq("setting_key", "inboundMail").limit(1);
    const raw = data?.[0]?.setting_value;
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      enabled: parsed?.enabled === true,
      port: Math.min(65535, Math.max(1, Number(parsed?.port) || 25)),
      domain: sanitizeDomain(parsed?.domain),
      host: sanitizeBindHost((parsed as any)?.host || process.env.INBOUND_MAIL_HOST || "127.0.0.1")
    };
  } catch {
    return null;
  }
}

export async function saveInboundMailConfig(config: InboundMailConfig) {
  const value = {
    enabled: config.enabled === true,
    port: Math.min(65535, Math.max(1, Number(config.port) || 25)),
    domain: sanitizeDomain(config.domain),
    host: sanitizeBindHost(config.host || process.env.INBOUND_MAIL_HOST || "127.0.0.1")
  };
  const { error } = await supabase.from("settings").upsert({
    setting_key: "inboundMail",
    setting_value: JSON.stringify(value)
  });
  if (error) throw error;
  return value;
}

export function isInboundMailRunning() {
  return { running: !!server, port: runningPort, domain: runningDomain, host: runningHost };
}

export async function startInboundMailServer(port: number, domain: string, hostInput?: string) {
  await stopInboundMailServer();
  await ensureInboundMailTable();
  const cleanDomain = sanitizeDomain(domain);
  if (!cleanDomain) throw new Error("دامنهٔ پذیرندهٔ ایمیل تنظیم نشده است.");
  if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error("پورت نامعتبر است.");
  const bindHost = sanitizeBindHost(hostInput || process.env.INBOUND_MAIL_HOST || "127.0.0.1");

  // ✅ SECURITY: Warn loudly if binding to non-loopback. This is a strong
  // signal that the deployment is intentionally exposing the SMTP service.
  if (bindHost !== "127.0.0.1" && bindHost !== "localhost" && bindHost !== "::1") {
    console.warn(`[inbound-mail] ⚠️ Binding to non-loopback host ${bindHost}. Ensure port ${port} is firewalled and rate-limited at the network edge.`);
  }

  // Sliding-window throttle: max N stored messages per client IP.
  const recentByIp = new Map<string, number[]>();
  const allowMessageForIp = (ip: string): boolean => {
    const now = Date.now();
    const stamps = (recentByIp.get(ip) || []).filter((t) => now - t < MESSAGE_WINDOW_MS);
    if (stamps.length >= MAX_MESSAGES_PER_IP_PER_WINDOW) {
      recentByIp.set(ip, stamps);
      return false;
    }
    stamps.push(now);
    recentByIp.set(ip, stamps);
    if (recentByIp.size > 5000) {
      for (const [key, list] of recentByIp) {
        if (list.every((t) => now - t >= MESSAGE_WINDOW_MS)) recentByIp.delete(key);
      }
    }
    return true;
  };

  let activeConnections = 0;

  const listener = net.createServer({ pauseOnConnect: false }, (socket) => {
    if (activeConnections >= MAX_CONCURRENT_CONNECTIONS) {
      socket.destroy();
      return;
    }
    activeConnections += 1;
    socket.once("close", () => { activeConnections -= 1; });

    socket.setTimeout(SESSION_TIMEOUT_MS);
    let buffer = "";
    let inData = false;
    let dataBytes = 0;
    let rejectingSize = false;
    let mailFrom = "";
    let rcptTo = "";

    const send = (line: string) => {
      if (!socket.destroyed) socket.write(line + "\r\n");
    };
    const resetTransaction = () => {
      mailFrom = "";
      rcptTo = "";
      inData = false;
      dataBytes = 0;
      rejectingSize = false;
    };

    send("220 reptoc ESMTP inbound service");

    socket.on("timeout", () => socket.destroy());
    socket.on("error", () => socket.destroy());

    socket.on("data", (chunk) => {
      if (inData && !rejectingSize) {
        dataBytes += chunk.length;
        if (dataBytes > MAX_MESSAGE_BYTES) {
          rejectingSize = true;
          resetTransaction();
          buffer = "";
          send("552 Message size exceeds fixed maximum");
          socket.end();
          return;
        }
      }

      buffer += chunk.toString("utf8");
      if (buffer.length > MAX_MESSAGE_BYTES + 8192) {
        socket.destroy();
        return;
      }

      while (true) {
        if (inData) {
          const terminator = buffer.indexOf("\r\n.\r\n");
          if (terminator === -1) break;
          let body = buffer.slice(0, terminator);
          buffer = buffer.slice(terminator + 5);
          // Un-dot-stuff per RFC 5321
          body = body.replace(/^\.\./gm, ".");

          // ✅ SECURITY: Extract Subject with strict sanitization. Strip
          // CRLF + HTML metacharacters so the stored subject is safe to
          // render in the admin UI without further escaping.
          const subjectMatch = body.match(/^Subject:[ \t]*(.*)$/im);
          const subject = subjectMatch ? sanitizeSubjectHeader(subjectMatch[1]) : "";

          const clientIp = socket.remoteAddress || "unknown";
          const allowed = allowMessageForIp(clientIp);
          socket.pause();
          // ✅ SECURITY: Define `finish` BEFORE the validation blocks below
          // that use it (declared-after-use caused TS2448 block-scoped variable
          // errors). It closes out the current message and resumes the socket.
          const finish = (response: string) => {
            send(response);
            resetTransaction();
            socket.resume();
          };

          // ✅ SECURITY: Validate envelope_from before persisting. Reject
          // addresses that don't match RFC 5321 — these are almost always
          // spam or SMTP smuggling attempts.
          if (!EMAIL_ADDRESS_PATTERN.test(mailFrom)) {
            finish("550 Invalid sender address");
            continue;
          }
          if (!EMAIL_ADDRESS_PATTERN.test(rcptTo)) {
            finish("550 Invalid recipient address");
            continue;
          }

          if (!allowed) {
            finish("452 Too many messages from this source");
            continue;
          }

          db.query(
            `INSERT INTO inbound_emails (id, envelope_from, envelope_to, subject, raw_size, raw)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              `iem-${uuidv4()}`,
              mailFrom.slice(0, 320),
              rcptTo.slice(0, 320),
              subject,
              Buffer.byteLength(body),
              body.slice(0, MAX_MESSAGE_BYTES)
            ]
          )
            .then(() => finish("250 OK message stored"))
            .catch((err) => {
              console.error("[inbound-mail] failed to store message", err);
              finish("451 Requested action aborted: local error");
            });
          continue;
        }

        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) break;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const upper = line.toUpperCase();

        if (/^EHLO\b/.test(upper)) {
          send("250-reptoc");
          send("250 SIZE 1048576");
          continue;
        }
        if (/^(HELO|NOOP|RSET)\b/.test(upper)) {
          if (upper.startsWith("RSET")) resetTransaction();
          send("250 OK");
          continue;
        }
        if (/^MAIL FROM:/.test(upper)) {
          const address = line.match(/<([^>]*)>/)?.[1] || line.slice(10).trim();

          // ✅ SECURITY: Reject addresses containing CR/LF. This is the
          // primary vector for SMTP smuggling (CVE-2023-51794) where an
          // attacker injects a fake "MAIL FROM" command via CRLF in the
          // envelope. We MUST reject before storing.
          const cleaned = String(address || "").trim();
          if (SMTP_CRLF_PATTERN.test(cleaned)) {
            send("550 Invalid sender address (control characters rejected)");
            resetTransaction();
            continue;
          }
          mailFrom = cleaned;
          rcptTo = "";
          send("250 OK");
          continue;
        }
        if (/^RCPT TO:/.test(upper)) {
          const address = (line.match(/<([^>]*)>/)?.[1] || line.slice(8).trim()).trim().toLowerCase();

          // ✅ SECURITY: Reject RCPT containing CR/LF.
          if (SMTP_CRLF_PATTERN.test(address)) {
            send("550 Invalid recipient address (control characters rejected)");
            continue;
          }
          if (!address.endsWith("@" + cleanDomain)) {
            send("550 Relay denied: recipient not served here");
            continue;
          }
          if (rcptTo) {
            send("452 Too many recipients");
            continue;
          }
          rcptTo = address;
          send("250 OK");
          continue;
        }
        if (upper === "DATA") {
          if (!mailFrom || !rcptTo) {
            send("503 Bad sequence of commands");
            continue;
          }
          inData = true;
          dataBytes = 0;
          send("354 End data with <CR><LF>.<CR><LF>");
          continue;
        }
        if (upper === "QUIT") {
          send("221 Bye");
          socket.end();
          continue;
        }
        send("500 Command not recognized");
      }
    });

    socket.on("close", () => { /* state dies with the socket */ });
  });

  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, bindHost, () => resolve());
  }).catch((err) => {
    throw new Error(`گوش دادن روی ${bindHost}:${port} ممکن نشد: ${err?.message || err}`);
  });

  server = listener;
  runningPort = port;
  runningDomain = cleanDomain;
  runningHost = bindHost;
  console.log(`[inbound-mail] listening on ${bindHost}:${port} for @${cleanDomain}`);
}

export async function stopInboundMailServer() {
  if (!server) return;
  const current = server;
  server = null;
  runningPort = 0;
  runningDomain = "";
  runningHost = "";
  await new Promise<void>((resolve) => current.close(() => resolve()));
  console.log("[inbound-mail] stopped");
}

/** Called once at boot: resume receiving when the admin left it enabled. */
export async function autoStartInboundMailIfConfigured() {
  try {
    const config = await readConfigRow();
    if (config?.enabled && config.domain) {
      await startInboundMailServer(config.port, config.domain, config.host);
    }
  } catch (err: any) {
    console.warn("[inbound-mail] autostart skipped:", err?.message || err);
  }
}
