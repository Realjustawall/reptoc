const DISCORD_API_BASE = "https://discord.com/api/v10";
const DEFAULT_DISCORD_GUILD_ID = "1511144508987805938";
const DEFAULT_DISCORD_CHANNEL_ID = "1519315578530168985";
const DEFAULT_PUBLIC_SITE_URL = "https://demo.reptoc.xyz";

// ✅ SECURITY: Hard timeout for Discord API calls. Without this, a slow or
// hung Discord API could keep request handlers blocked indefinitely,
// eventually exhausting the Express connection pool.
const DISCORD_FETCH_TIMEOUT_MS = Number(process.env.DISCORD_FETCH_TIMEOUT_MS || 10_000);

function absoluteUrl(pathOrUrl: string) {
  const value = String(pathOrUrl || "").trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\/\//.test(value)) return `https:${value}`;
  const baseUrl = String(process.env.PUBLIC_SITE_URL || process.env.APP_URL || DEFAULT_PUBLIC_SITE_URL).replace(/\/+$/, "");
  return `${baseUrl}${value.startsWith("/") ? value : `/${value}`}`;
}

function truncate(text: unknown, maxLength: number) {
  const value = String(text || "").trim();
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}...` : value;
}

function isHttpUrl(value: unknown) {
  return typeof value === "string" && value.length <= 2048 && /^https?:\/\//i.test(value);
}

export function discordGenreColor(genre: unknown) {
  const value = String(genre || "").toLowerCase();
  if (/horror|thriller/.test(value)) return 0x991b1b;
  if (/romance|love/.test(value)) return 0xec4899;
  if (/fantasy|litrpg|cultivation|magic/.test(value)) return 0x7c3aed;
  if (/sci|space|cyber|future/.test(value)) return 0x0891b2;
  if (/mystery|noir|crime|detective/.test(value)) return 0xd97706;
  if (/action|adventure|martial/.test(value)) return 0xdc2626;
  if (/comedy|slice[ -]of[ -]life/.test(value)) return 0x16a34a;
  if (/history|historical/.test(value)) return 0x92400e;
  return 0x5865f2;
}

export function buildChapterPublishedEmbed(novel: any, chapter: any, guildId = "") {
  const novelId = novel?.id || chapter?.novel_id;
  const chapterId = chapter?.id;
  const chapterUrl = absoluteUrl(`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`);
  const novelUrl = absoluteUrl(`/novels/${encodeURIComponent(novelId)}`);
  const rawCover = String(novel?.cover_url || novel?.coverUrl || novel?.cover || "").trim();
  const isInlineCover = rawCover.startsWith("data:image/");
  const isExternalCover = /^https?:\/\//i.test(rawCover) || /^\/\//.test(rawCover);
  const resolvedCover = !rawCover ? "" : isInlineCover
    ? absoluteUrl(`/api/novels/${encodeURIComponent(novelId)}/cover`)
    : absoluteUrl(rawCover);
  // A chapter-specific query prevents Discord's image proxy from reusing a stale
  // response for a cover that was replaced but retained the same public URL.
  const coverUrl = resolvedCover && isHttpUrl(resolvedCover)
    ? (isExternalCover ? resolvedCover : `${resolvedCover}${resolvedCover.includes("?") ? "&" : "?"}discord_chapter=${encodeURIComponent(chapterId)}`)
    : "";
  const author = truncate(novel?.author || "نویسنده رپتوک", 80);
  const chapterTitle = truncate(chapter?.title || "فصل جدید", 240);
  const novelTitle = truncate(novel?.title || "داستان بی‌نام", 240);
  const chapterNumber = Number(chapter?.chapter_number || chapter?.chapterNumber || 0);
  const wordCount = Number(chapter?.word_count || chapter?.wordCount || 0);

  const embed: any = {
    title: "انتشار فصل جدید",
    url: chapterUrl,
    description: [
      `**${chapterTitle}** هم‌اکنون در **${novelTitle}** منتشر شد.`,
      "",
      `[خواندن فصل](${chapterUrl}) | [مشاهده داستان](${novelUrl})`
    ].join("\n"),
    color: discordGenreColor(novel?.genre),
    fields: [
      { name: "داستان", value: `[${novelTitle}](${novelUrl})`, inline: true },
      { name: "فصل", value: chapterNumber > 0 ? `#${chapterNumber}` : "آخرین فصل", inline: true },
      { name: "نویسنده", value: author, inline: true }
    ],
    footer: { text: `کتابخانه رپتوک${guildId ? ` | سرور ${guildId}` : ""}` },
    timestamp: new Date(chapter?.published_at || Date.now()).toISOString()
  };
  if (wordCount > 0) embed.fields.push({ name: "حجم فصل", value: `${wordCount.toLocaleString("en-US")} واژه`, inline: true });
  if (novel?.genre) embed.fields.push({ name: "ژانر", value: truncate(novel.genre, 80), inline: true });
  if (coverUrl) embed.image = { url: coverUrl };
  return embed;
}

let gatewaySocket: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function startDiscordBotPresence() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || typeof WebSocket === "undefined" || gatewaySocket) return;

  const connect = () => {
    if (gatewaySocket) return;
    const socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
    gatewaySocket = socket;
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data || "{}"));
        if (payload.op === 10) {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          const heartbeat = () => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ op: 1, d: null }));
          heartbeat();
          heartbeatTimer = setInterval(heartbeat, Number(payload.d?.heartbeat_interval || 45000));
          socket.send(JSON.stringify({
            op: 2,
            d: {
              token,
              intents: 0,
              properties: { os: process.platform, browser: "reptoc", device: "reptoc" },
              presence: {
                status: "online",
                since: null,
                afk: false,
                activities: [{ name: "فصل‌های تازه در رپتوک", type: 3 }]
              }
            }
          }));
        } else if (payload.op === 7 || payload.op === 9) {
          socket.close();
        } else if (payload.t === "READY") {
          console.log(`[discord] ${payload.d?.user?.username || "Reptoc"} is online.`);
        }
      } catch (error: any) {
        console.warn("[discord] Gateway payload error:", error?.message || error);
      }
    });
    socket.addEventListener("close", () => {
      gatewaySocket = null;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (!reconnectTimer) reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 5000);
    });
    socket.addEventListener("error", () => socket.close());
  };
  connect();
}

/**
 * ✅ SECURITY: Wrap the Discord webhook call with a hard timeout.
 *
 * Without this, a slow Discord API response (or a network hang) could
 * keep the request handler blocked indefinitely, eventually exhausting
 * the Express connection pool under load. The timeout also ensures that
 * failed chapter-publish announcements don't degrade the user-facing
 * publishing flow.
 */
export async function sendDiscordChapterPublishedAnnouncement(novel: any, chapter: any) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID || DEFAULT_DISCORD_CHANNEL_ID;
  const guildId = process.env.DISCORD_GUILD_ID || DEFAULT_DISCORD_GUILD_ID;
  if (!token || !channelId) return { skipped: true };

  const novelId = novel?.id || chapter?.novel_id;
  const chapterId = chapter?.id;
  if (!novelId || !chapterId) return { skipped: true };

  const embed = buildChapterPublishedEmbed(novel, chapter, guildId);

  try {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "فصل تازه‌ای منتشر شد.",
        embeds: [embed],
        allowed_mentions: { parse: [] }
      }),
      // ✅ SECURITY: Hard timeout. Prevents a slow Discord API from blocking
      // the publishing flow.
      signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // ✅ SECURITY: Never throw out of this function — chapter publishing
      // must not fail because Discord is unavailable. Log and swallow.
      console.error(`[discord] Announcement failed: ${response.status} ${body.slice(0, 300)}`);
      return { skipped: true, reason: `http_${response.status}` };
    }
    return { success: true };
  } catch (err: any) {
    // ✅ SECURITY: Network error, timeout, or abort. Log and swallow.
    console.error("[discord] Announcement network error:", err?.name || err?.message || err);
    return { skipped: true, reason: "network_error" };
  }
}
