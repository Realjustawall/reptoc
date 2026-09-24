import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApplicationContentSecurityPolicy } from "../server/security/contentSecurityPolicy";

test("the global HTML shell loads the configured Goftino widget", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /https:\/\/www\.goftino\.com\/widget\//);
  assert.match(html, /var i="rUX5gl"/);
});

test("the document CSP permits Goftino widget assets", () => {
  const policy = buildApplicationContentSecurityPolicy();

  assert.match(policy, /script-src[^;]*https:\/\/\*\.goftino\.com/);
  assert.match(policy, /style-src[^;]*https:\/\/\*\.goftino\.com/);
  assert.match(policy, /media-src[^;]*https:\/\/\*\.goftino\.com/);
  assert.match(policy, /frame-src[^;]*https:\/\/\*\.goftino\.com/);
});

test("Goftino is loaded once from the SPA shell and keeps its visitor session", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  assert.equal((html.match(/goftino\.com\/widget/g) || []).length, 1);
  assert.match(html, /localStorage\.getItem\("goftino_"\+i\)/);
  assert.match(html, /g\.async=!0/);
});
