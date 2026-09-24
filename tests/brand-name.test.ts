import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeBrandName } from "../src/utils/brandName";

test("legacy brand spellings normalize to the current Persian name", () => {
  assert.equal(normalizeBrandName("\u0631\u06cc\u0648\u062a\u0648\u06a9"), "رپتوک");
  assert.equal(normalizeBrandName("\u0631\u06cc\u0648\u062a\u06a9"), "رپتوک");
  assert.equal(normalizeBrandName("\u0631\u06cc\u062a\u0648\u06a9"), "رپتوک");
  assert.equal(normalizeBrandName("رپتوک"), "رپتوک");
});

test("browser title and metadata are normalized too", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /title = normalizeBrandName\(title\)/);
  assert.match(app, /description = normalizeBrandName\(description\)/);
  assert.match(app, /document\.title = title/);
  assert.match(app, />\s*رپتوک\s*<\/span>/);
  assert.doesNotMatch(app, /src="\/logo\.png"/);
});
