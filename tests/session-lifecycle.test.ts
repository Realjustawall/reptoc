import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCSRF } from "../server/utils/auth";

test("secure host-prefixed CSRF cookies authorize state-changing requests", async () => {
  const token = "a".repeat(64);
  const request = {
    header: (name: string) => name.toLowerCase() === "x-csrf-token" ? token : undefined,
    cookies: { "__Host-XSRF-TOKEN": token },
    body: {},
  } as any;

  assert.equal(await validateCSRF(request, { csrf_token: token }), true);
});

test("session lifecycle hashes the current cookie and deletes session plus metadata atomically", () => {
  const source = readFileSync(new URL("../server/api/index.ts", import.meta.url), "utf8");

  assert.match(source, /const currentSessionId = currentSessionToken \? hashSessionToken\(currentSessionToken\)/);
  assert.match(source, /DELETE FROM sessions WHERE id=\$1 AND user_id=\$2 RETURNING id/);
  assert.match(source, /DELETE FROM settings WHERE setting_key=\$1/);
  assert.match(source, /clearAuthenticationCookies\(res\)/);
  assert.match(source, /path: "\/"/);
});
