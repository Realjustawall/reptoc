import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScrollContainer } from "../src/components/Dashboard";
import { readFileSync } from "node:fs";

test("homepage shelves preserve vertical touch scrolling on phones", () => {
  const markup = renderToStaticMarkup(
    <ScrollContainer>
      <article>Novel</article>
    </ScrollContainer>,
  );

  assert.match(markup, /home-shelf-scroller/);
  assert.match(markup, /touch-action:pan-x pan-y/);
  assert.match(markup, /snap-proximity sm:snap-mandatory/);
  assert.doesNotMatch(markup, /touch-pan-x/);
});

test("mobile shell avoids stale navigation waits and oversized navbar logo", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const logo = readFileSync(new URL("../public/logo-128.webp", import.meta.url));

  assert.match(app, /AnimatePresence mode="wait" initial=\{false\}/);
  assert.match(app, /window\.scrollTo\(0, 0\)/);
  assert.match(app, /src="\/logo-128\.webp"/);
  assert.ok(logo.byteLength < 20_000);
  assert.match(main, /serviceWorker\.register\("\/sw\.js"/);
  assert.match(main, /updateViaCache: "none"/);
});
