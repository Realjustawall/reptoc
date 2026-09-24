import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { buildApplicationContentSecurityPolicy, quotedScriptHash } from "../server/security/contentSecurityPolicy";
import { GOOGLE_ANALYTICS_INLINE_SCRIPT } from "../shared/analytics";

const AD_MODULES = [
  "src/components/ads/AdSlot.tsx",
  "src/components/ads/AdvertisementProvider.tsx",
  "src/components/admin/AdvertisementAdmin.tsx",
  "src/utils/legacyAdCleanup.ts",
  "server/api/routes/ads.ts",
  "server/advertisements/advertisementService.ts",
  "server/advertisements/advertisementCsp.ts",
  "shared/advertisements.ts",
];

test("every advertisement module is deleted", () => {
  for (const path of AD_MODULES) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, `${path} still exists`);
  }
});

test("the document CSP authorizes no advertising origin and only the support frame", () => {
  const policy = buildApplicationContentSecurityPolicy([quotedScriptHash(GOOGLE_ANALYTICS_INLINE_SCRIPT)]);

  for (const host of ["pagead2", "googlesyndication", "doubleclick", "highperformanceformat", "untimely-hello", "moneitag", "profitabledisplaynetwork"]) {
    assert.doesNotMatch(policy, new RegExp(host), `CSP still authorizes ${host}`);
  }
  // Cross-site frames stay closed except for the explicitly installed support
  // widget; there is still no broad `https:` frame escape hatch.
  const frameDirective = policy.match(/(?:^|; )frame-src ([^;]+)/)?.[1] || "";
  assert.deepEqual(frameDirective.split(/\s+/), ["'self'", "https://goftino.com", "https://*.goftino.com"]);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  // The shell's own bootstrap stays authorized by hash.
  assert.ok(policy.includes(quotedScriptHash(GOOGLE_ANALYTICS_INLINE_SCRIPT)));
  assert.match(policy, /https:\/\/www\.googletagmanager\.com/);
});

test("no source file references an advertising provider", () => {
  const roots = ["src", "server", "shared"];
  const offenders: string[] = [];
  const walk = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
      const text = readFileSync(child, "utf8");
      if (/adsterra|adsbygoogle|pagead2|googlesyndication|untimely-hello|highperformanceformat/i.test(text)) {
        offenders.push(child.pathname);
      }
    }
  };
  for (const root of roots) walk(new URL(`../${root}/`, import.meta.url));
  assert.deepEqual(offenders, []);
});

test("the HTML shell loads no advertising script", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /adsbygoogle|pagead2|googlesyndication|adsterra/i);
});

test("the ads API route is unmounted", () => {
  const api = readFileSync(new URL("../server/api/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(api, /adsRouter/);
  assert.doesNotMatch(api, /router\.use\("\/ads"/);
  // Legacy `ad_*` settings must be dropped rather than sanitized and kept.
  assert.match(api, /if \(key\.startsWith\("ad_"\)\) delete next\[key\]/);
});
