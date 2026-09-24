import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("staff-only views send unauthorised visitors to the home page", () => {
  // /authority-center and /editor-panel are reachable by URL and by a restored
  // navigation state, so a reader with a saved link — or a demoted staff member —
  // used to land on a panel that rendered empty and produced 403s.
  assert.match(app, /"authority-center": \["publisher", "owner"\]/);
  assert.match(app, /"editor-panel": \["editor", "publisher", "owner"\]/);
  assert.match(app, /if \(currentUser && allowed\.includes\(userRole\)\) return;/);
  assert.match(app, /setActiveView\("dashboard"\);/);
});

test("the guard waits for authentication so a real owner is never bounced", () => {
  const guard = app.slice(app.indexOf("Route guard for the staff panels"));
  // `userRole` is "writer" until api.getMe() resolves; guarding before that would
  // eject a genuine owner who deep-linked to the panel.
  assert.match(guard.slice(0, 1400), /if \(loadingInitial\) return;/);
  assert.match(guard.slice(0, 1400), /loadingInitial, userRole\]/);
});

test("the panels stay hidden from navigation for roles that cannot use them", () => {
  // The guard is a UI correction, not the security boundary: the sidebar already
  // hides these entries and every admin endpoint re-checks the role server-side.
  assert.match(app, /\.\.\.\(\["editor", "publisher", "owner"\]\.includes\(userRole\) \? \[\{ id: "editor-panel"/);
  assert.match(app, /\.\.\.\(userRole === "publisher" \|\| userRole === "owner" \? \[\{ id: "authority-center"/);
});
