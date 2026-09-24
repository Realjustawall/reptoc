import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { READING_MUSIC_TRACKS, type ReadingMusicTrackId } from "../../shared/readingMusic";

const STORAGE_KEY = "reptoc-reading-music-v1";

interface MusicPreferences {
  trackId: ReadingMusicTrackId;
  volume: number;
  muted: boolean;
}

type ReadingAudioElement = Pick<HTMLAudioElement, "paused" | "currentTime" | "play" | "pause" | "load" | "removeAttribute">;

export function createReadingMusicSession(audio: ReadingAudioElement) {
  let disposed = false;
  let generation = 0;
  let pending: Promise<boolean> | null = null;

  const play = () => {
    if (disposed) return Promise.resolve(false);
    if (!audio.paused) return Promise.resolve(true);
    if (pending) return pending;
    const requestedGeneration = generation;
    const request = Promise.resolve(audio.play())
      .then(() => !disposed && requestedGeneration === generation && !audio.paused)
      .catch((error) => {
        if (disposed || requestedGeneration !== generation) return false;
        throw error;
      })
      .finally(() => {
        if (pending === request) pending = null;
      });
    pending = request;
    return request;
  };

  const pause = (reset = false) => {
    generation += 1;
    pending = null;
    audio.pause();
    if (reset) audio.currentTime = 0;
  };

  return {
    play,
    pause,
    isPlayingOrPending: () => Boolean(pending) || !audio.paused,
    reset: () => {
      pause(true);
      audio.load();
    },
    dispose: () => {
      disposed = true;
      pause(true);
      audio.removeAttribute("src");
      audio.load();
    },
  };
}

export function normalizeMusicPreferences(value: unknown): MusicPreferences {
  const input = value && typeof value === "object" ? value as Partial<MusicPreferences> : {};
  const trackId = READING_MUSIC_TRACKS.some((track) => track.id === input.trackId)
    ? input.trackId as ReadingMusicTrackId
    : READING_MUSIC_TRACKS[0].id;
  const volume = Number.isFinite(Number(input.volume))
    ? Math.max(0, Math.min(1, Number(input.volume)))
    : 0.35;
  return { trackId, volume, muted: input.muted === true };
}

export default function ReadingMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<ReturnType<typeof createReadingMusicSession> | null>(null);
  const sessionAudioRef = useRef<HTMLAudioElement | null>(null);
  const previousTrackRef = useRef<ReadingMusicTrackId | null>(null);
  const resumeAfterTrackChangeRef = useRef(false);
  const [preferences, setPreferences] = useState<MusicPreferences>(() => {
    try {
      return normalizeMusicPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch {
      return normalizeMusicPreferences({});
    }
  });
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const activeTrack = READING_MUSIC_TRACKS.find((track) => track.id === preferences.trackId) || READING_MUSIC_TRACKS[0];

  const getSession = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return null;
    if (!sessionRef.current || sessionAudioRef.current !== audio) {
      sessionRef.current?.dispose();
      sessionAudioRef.current = audio;
      sessionRef.current = createReadingMusicSession(audio);
    }
    return sessionRef.current;
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    if (audioRef.current) {
      audioRef.current.volume = preferences.volume;
      audioRef.current.muted = preferences.muted;
    }
  }, [preferences]);

  const play = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    setError("");
    try {
      const didPlay = await session.play();
      setPlaying(didPlay);
    } catch (playError) {
      console.error("Reading music playback failed", playError);
      setPlaying(false);
      setError("پخش این قطعه ممکن نشد. اتصال اینترنت یا تنظیمات صدای مرورگر خود را بررسی کنید.");
    }
  }, [getSession]);

  const pause = useCallback(() => {
    getSession()?.pause();
    setPlaying(false);
  }, [getSession]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden && audioRef.current && !audioRef.current.paused) {
        pause();
      }
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, [pause]);

  useEffect(() => () => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    sessionAudioRef.current = null;
  }, []);

  useEffect(() => {
    if (previousTrackRef.current === null) {
      previousTrackRef.current = activeTrack.id;
      return;
    }
    if (previousTrackRef.current === activeTrack.id) return;
    previousTrackRef.current = activeTrack.id;
    getSession()?.reset();
    setPlaying(false);
    if (resumeAfterTrackChangeRef.current) {
      resumeAfterTrackChangeRef.current = false;
      void play();
    }
  }, [activeTrack.id, getSession, play]);

  const selectTrack = (trackId: ReadingMusicTrackId) => {
    resumeAfterTrackChangeRef.current = playing || Boolean(getSession()?.isPlayingOrPending());
    setPreferences((current) => ({ ...current, trackId }));
    setError("");
  };

  return (
    <section aria-label="موسیقی اختیاری هنگام مطالعه" className="rounded-2xl border border-current/10 bg-current/[0.035] p-3">
      <audio
        ref={audioRef}
        src={`/media/reading-music/${encodeURIComponent(activeTrack.id)}.wav?v=2`}
        preload="none"
        loop
        onError={() => {
          setPlaying(false);
          setError("قطعه انتخابی برای مطالعه موقتاً در دسترس نیست.");
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={playing ? pause : play}
          aria-label={playing ? "توقف موسیقی مطالعه" : "پخش موسیقی مطالعه"}
          aria-pressed={playing}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <label className="min-w-36 flex-1">
          <span className="sr-only">قطعه موسیقی مطالعه</span>
          <select
            value={preferences.trackId}
            onChange={(event) => void selectTrack(event.target.value as ReadingMusicTrackId)}
            className="w-full rounded-lg border border-current/15 bg-transparent px-2.5 py-2 text-xs font-bold"
          >
            {READING_MUSIC_TRACKS.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setPreferences((current) => ({ ...current, muted: !current.muted }))}
          aria-label={preferences.muted ? "فعال کردن صدای موسیقی مطالعه" : "بی‌صدا کردن موسیقی مطالعه"}
          aria-pressed={preferences.muted}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-current/15"
        >
          {preferences.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <label className="flex items-center gap-2 text-[10px] font-bold">
          <span>صدا</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={preferences.volume}
            onChange={(event) => setPreferences((current) => ({ ...current, volume: Number(event.target.value) }))}
            aria-label="صدای موسیقی مطالعه"
            className="w-20 accent-violet-500 sm:w-28"
          />
        </label>
      </div>
      <p className="mt-1.5 text-[10px] opacity-60" aria-live="polite">
        {playing ? `در حال پخش ${activeTrack.name}` : `${activeTrack.name} · خاموش است تا دکمه پخش را بزنید`}
      </p>
      {error && <p role="alert" className="mt-1 text-[10px] font-semibold text-rose-500">{error}</p>}
    </section>
  );
}
