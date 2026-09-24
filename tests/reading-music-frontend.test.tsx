import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReadingMusicPlayer, { createReadingMusicSession, normalizeMusicPreferences } from "../src/components/ReadingMusicPlayer";
import SafeImage from "../src/components/SafeImage";

test("reading music renders off without autoplay before user interaction", () => {
  const html = renderToStaticMarkup(<ReadingMusicPlayer />);
  assert.doesNotMatch(html, /\bautoplay\b/i);
  assert.match(html, /preload="none"/);
  assert.match(html, /خاموش است تا دکمه پخش را بزنید/);
  assert.match(html, /aria-label="پخش موسیقی مطالعه"/);
  assert.equal((html.match(/<audio\b/g) || []).length, 1);
});

test("music preferences constrain track IDs and volume", () => {
  assert.deepEqual(normalizeMusicPreferences({ trackId: "bad", volume: 4, muted: true }), {
    trackId: "quiet-rain", volume: 1, muted: true,
  });
});

test("reading music session deduplicates play and tears down the same audio element", async () => {
  let playCalls = 0;
  let pauseCalls = 0;
  let loadCalls = 0;
  let removedSource = false;
  let finishPlay: (() => void) | undefined;
  const audio = {
    paused: true,
    currentTime: 12,
    play() {
      playCalls += 1;
      return new Promise<void>((resolve) => {
        finishPlay = () => {
          audio.paused = false;
          resolve();
        };
      });
    },
    pause() {
      pauseCalls += 1;
      audio.paused = true;
    },
    load() {
      loadCalls += 1;
    },
    removeAttribute(name: string) {
      if (name === "src") removedSource = true;
    },
  };
  const session = createReadingMusicSession(audio);
  const firstPlay = session.play();
  const repeatedPlay = session.play();
  assert.equal(playCalls, 1);
  finishPlay?.();
  assert.equal(await firstPlay, true);
  assert.equal(await repeatedPlay, true);

  session.dispose();
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
  assert.equal(removedSource, true);
  assert.equal(loadCalls, 1);
  assert.ok(pauseCalls >= 1);
  assert.equal(await session.play(), false);
  assert.equal(playCalls, 1);
});

test("reading music session can replace an interrupted pending track without overlap", async () => {
  const pendingPlays: Array<() => void> = [];
  const audio = {
    paused: true,
    currentTime: 0,
    play() {
      return new Promise<void>((resolve) => {
        pendingPlays.push(() => {
          audio.paused = false;
          resolve();
        });
      });
    },
    pause() {
      audio.paused = true;
    },
    load() {},
    removeAttribute() {},
  };
  const session = createReadingMusicSession(audio);
  const interruptedPlay = session.play();
  session.reset();
  const replacementPlay = session.play();
  assert.equal(pendingPlays.length, 2);
  pendingPlays[1]();
  assert.equal(await replacementPlay, true);
  pendingPlays[0]();
  assert.equal(await interruptedPlay, false);
});

test("image component renders a visual fallback for a missing source", () => {
  const html = renderToStaticMarkup(<SafeImage src="" alt="Cover" />);
  assert.match(html, /src="\/image-fallback\.svg"/);
  assert.match(html, /data-image-fallback="true"/);
});
