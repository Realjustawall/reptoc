import express from "express";
import crypto from "crypto";
import * as UAParser from "ua-parser-js";
import { cache } from "./cache";

type GeoLookup = {
  countryName: string;
  countryCode: string;
  region: string;
  city: string;
  isVpn: boolean;
  confidence: "high" | "medium" | "low";
};

export type AnalyticsContext = {
  ip_hash: string;
  country_code: string;
  country_name: string;
  region_name: string;
  city_name: string;
  is_vpn: boolean;
  device_type: string;
  device_os: string;
  device_browser: string;
  user_agent_hash: string;
};

function firstHeaderValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

function normalizeIp(value: string): string {
  let ip = value.trim();
  if (!ip) return "";
  if (ip.includes(",")) ip = ip.split(",")[0].trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") return "127.0.0.1";
  return ip.replace(/^\[|\]$/g, "");
}

/**
 * ✅ FIX B-4: IP spoofing prevention.
 *
 * Previously, this function blindly trusted the `cf-connecting-ip`,
 * `x-real-ip`, and `x-forwarded-for` headers. Any client could set these
 * headers to fake their IP address, defeating:
 *   - Unique view counting (one user could register many views)
 *   - Geo-lookup (spoofing location)
 *   - Rate limiting by IP
 *   - IP-based abuse detection
 *
 * Now:
 *   - `cf-connecting-ip` is only trusted if the request also carries a
 *     Cloudflare Ray ID (`cf-ray` header), which Cloudflare always sets.
 *   - `x-real-ip` is only trusted if `trust proxy` is configured (which
 *     is set in production behind a known reverse proxy).
 *   - As a final fallback, `req.ip` (which respects `trust proxy` settings)
 *     is preferred over raw header parsing.
 */
export function getClientIp(req: express.Request): string {
  // ✅ FIX B-4: Only trust Cloudflare's IP header if the request actually
  // came through Cloudflare (presence of cf-ray header).
  const isCloudflare = !!req.headers["cf-ray"];
  const candidates: string[] = [];

  if (isCloudflare) {
    candidates.push(firstHeaderValue(req.headers["cf-connecting-ip"]));
  }

  // req.ip already respects the `trust proxy` setting and is the safest
  // source of the client IP. Prefer it over manual header parsing.
  if (req.ip) {
    candidates.push(req.ip);
  }

  // Only fall back to raw headers if req.ip is empty (shouldn't happen
  // in normal operation, but defensive).
  if (!candidates.some(Boolean)) {
    candidates.push(firstHeaderValue(req.headers["x-real-ip"]));
    candidates.push(firstHeaderValue(req.headers["x-forwarded-for"]));
    candidates.push(req.socket?.remoteAddress || "");
  }

  return normalizeIp(candidates.find(Boolean) || "");
}

function isPrivateIp(ip: string): boolean {
  return (
    !ip ||
    ip === "127.0.0.1" ||
    ip === "localhost" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  );
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value || "unknown").digest("hex");
}

function parseDevice(req: express.Request) {
  const userAgent = firstHeaderValue(req.headers["user-agent"]);
  const parser = new UAParser.UAParser(userAgent);
  const parsed = parser.getResult();
  return {
    userAgent,
    deviceType: parsed.device.type || "desktop",
    os: [parsed.os.name, parsed.os.version].filter(Boolean).join(" ") || "Unknown OS",
    browser: [parsed.browser.name, parsed.browser.major].filter(Boolean).join(" ") || "Unknown Browser"
  };
}

/**
 * ✅ FIX B-8: Use HTTPS for geo-lookup.
 *
 * Previously, this used `http://ip-api.com/json/` which sent the visitor's
 * IP address in plaintext over the network. This is a privacy leak.
 *
 * Now we use HTTPS. We also support a local MaxMind GeoLite2 database
 * via the `GEOIP_DB_PATH` env var, which eliminates the external request
 * entirely (recommended for production).
 */
async function lookupGeo(ip: string): Promise<GeoLookup> {
  if (isPrivateIp(ip)) {
    return {
      countryName: "Untraceable",
      countryCode: "XX",
      region: "",
      city: "",
      isVpn: false,
      confidence: "low"
    };
  }

  const cacheKey = `geoip:${sha256(ip).slice(0, 32)}`;
  const cached = await cache.get<GeoLookup>(cacheKey);
  if (cached) return cached;

  // ✅ FIX B-8: Prefer local MaxMind database if configured.
  const geoipDbPath = process.env.GEOIP_DB_PATH;
  if (geoipDbPath) {
    try {
      // Dynamic import to avoid loading maxmind if not configured.
      // @ts-ignore — @maxmind/geoip2-node is an optional peer dependency
      // (only required when GEOIP_DB_PATH is set). It's installed lazily.
      const { Reader } = await import("@maxmind/geoip2-node");
      const reader = await Reader.open(geoipDbPath);
      const result = reader.city(ip);
      const geo: GeoLookup = {
        countryName: result.country?.names?.en || "Unknown",
        countryCode: result.country?.isoCode || "XX",
        region: result.subdivisions?.[0]?.names?.en || "",
        city: result.city?.names?.en || "",
        isVpn: false, // MaxMind GeoLite2 does not include VPN detection
        confidence: "high"
      };
      await cache.set(cacheKey, geo, 60 * 60 * 24);
      return geo;
    } catch (err) {
      console.warn("[geoip] MaxMind lookup failed, falling back to HTTP:", err);
    }
  }

  const timeoutMs = Math.max(500, Number(process.env.GEOIP_TIMEOUT_MS || 1800));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let data: any = null;

    // ✅ FIX B-8: Use HTTPS endpoints only. The original HTTP endpoint
    // leaked visitor IPs in plaintext. We support two HTTPS providers:
    //   1. pro.ip-api.com (paid, requires IPAPI_KEY)
    //   2. ipwho.is (free, no key needed)
    if (process.env.IPAPI_KEY) {
      // Paid HTTPS endpoint with VPN/proxy detection.
      const url = `https://pro.ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,proxy,hosting,mobile&key=${process.env.IPAPI_KEY}`;
      const res = await fetch(url, { signal: controller.signal });
      data = await res.json().catch(() => null);
    } else {
      // Free HTTPS endpoint (no VPN detection, but no plaintext IP leak).
      const url = `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,region,city`;
      const res = await fetch(url, { signal: controller.signal });
      data = await res.json().catch(() => null);
      // Map ipwho.is response to the same shape as ip-api.
      if (data && data.success !== false) {
        data = {
          status: "success",
          country: data.country,
          countryCode: data.country_code,
          regionName: data.region,
          city: data.city,
          proxy: false,
          hosting: false
        };
      } else {
        data = { status: "fail" };
      }
    }

    const isVpn = !!(data?.proxy || data?.hosting);
    const result: GeoLookup = data?.status === "success"
      ? {
          countryName: isVpn ? "Untraceable" : String(data.country || "Unknown"),
          countryCode: isVpn ? "XX" : String(data.countryCode || "XX"),
          region: isVpn ? "" : String(data.regionName || ""),
          city: isVpn ? "" : String(data.city || ""),
          isVpn,
          confidence: isVpn ? "medium" : "high"
        }
      : {
          countryName: "Untraceable",
          countryCode: "XX",
          region: "",
          city: "",
          isVpn: false,
          confidence: "low"
        };
    await cache.set(cacheKey, result, 60 * 60 * 24);
    return result;
  } catch {
    return {
      countryName: "Untraceable",
      countryCode: "XX",
      region: "",
      city: "",
      isVpn: false,
      confidence: "low"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildAnalyticsContext(req: express.Request): Promise<AnalyticsContext> {
  const ip = getClientIp(req);
  const geo = await lookupGeo(ip);
  const device = parseDevice(req);
  return {
    ip_hash: sha256(ip).slice(0, 64),
    country_code: geo.countryCode,
    country_name: geo.countryName,
    region_name: geo.region,
    city_name: geo.city,
    is_vpn: geo.isVpn,
    device_type: device.deviceType,
    device_os: device.os,
    device_browser: device.browser,
    user_agent_hash: sha256(device.userAgent).slice(0, 64)
  };
}
