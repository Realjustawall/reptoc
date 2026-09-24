import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUsername,
  RESERVED_USERNAMES,
  USERNAME_CHANGE_COOLDOWN_MS,
  usernameChangeAvailableAt,
  validateUsername,
} from "../server/utils/usernames";

test("username validation is case-insensitive and permits only the public format", () => {
  assert.deepEqual(validateUsername("  Reader_42  "), {
    ok: true,
    username: "Reader_42",
    normalized: "reader_42",
  });
  assert.equal(validateUsername("ab").ok, false);
  assert.equal(validateUsername("reader-name").ok, false);
  assert.equal(validateUsername("reader name").ok, false);
  assert.equal(validateUsername("x".repeat(31)).ok, false);
  assert.equal(validateUsername("JOHN").ok, true);
  assert.equal(normalizeUsername(" John "), normalizeUsername("JOHN"));
});

test("reserved usernames are rejected regardless of casing", () => {
  for (const reserved of RESERVED_USERNAMES) {
    assert.equal(validateUsername(reserved.toUpperCase()).ok, false);
  }
});

test("the next username change is exactly fourteen days after the committed change", () => {
  const changedAt = "2026-07-01T12:00:00.000Z";
  const availableAt = usernameChangeAvailableAt(changedAt);
  assert.equal(
    new Date(String(availableAt)).getTime() - new Date(changedAt).getTime(),
    USERNAME_CHANGE_COOLDOWN_MS,
  );
  assert.equal(USERNAME_CHANGE_COOLDOWN_MS, 14 * 24 * 60 * 60 * 1000);
  assert.equal(usernameChangeAvailableAt(null), null);
});
