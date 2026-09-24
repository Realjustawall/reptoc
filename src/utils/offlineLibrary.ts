import type { Chapter, Novel } from "../types";
import type { MangaPage } from "../../shared/manga";

const DATABASE = "reptoc-offline-library";
const STORE = "chapters";
const MEDIA_CACHE = "reptoc-offline-media-v1";

export interface OfflineChapterRecord { id: string; novel: Novel; chapter: Chapter; downloadedAt: string; }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("novelId", "novel.id", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("باز کردن کتابخانه آفلاین ناموفق بود."));
  });
}

function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("عملیات آفلاین ناموفق بود."));
    tx.oncomplete = () => database.close();
  }));
}

export async function listOfflineChapters(): Promise<OfflineChapterRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const rows = await transaction<OfflineChapterRecord[]>("readonly", (store) => store.getAll());
  return rows.sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
}

export async function isChapterOffline(novelId: string, chapterId: string) {
  if (typeof indexedDB === "undefined") return false;
  return !!(await transaction<OfflineChapterRecord | undefined>("readonly", (store) => store.get(`${novelId}:${chapterId}`)));
}

function mediaUrls(novel: Novel, chapter: Chapter, pages: MangaPage[]) {
  const urls = new Set<string>();
  const cover = String(novel.coverUrl || novel.cover || "").trim();
  if (cover) urls.add(cover);
  for (const match of String(chapter.content || "").matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) urls.add(match[1]);
  for (const page of pages) if (page.imageUrl) urls.add(page.imageUrl);
  return [...urls];
}

async function cacheUrl(cache: Cache, value: string) {
  try {
    const url = new URL(value, location.origin);
    const response = await fetch(url.href, { credentials: url.origin === location.origin ? "same-origin" : "omit", mode: url.origin === location.origin ? "same-origin" : "no-cors" });
    if (response.ok || response.type === "opaque") await cache.put(url.href, response);
  } catch {}
}

async function cacheApplicationShell(cache: Cache) {
  const resources = new Set<string>(["/", "/manifest.webmanifest", "/logo-128.webp", "/fonts/Estedad-Variable.woff2"]);
  for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    try {
      const url = new URL(entry.name);
      if (url.origin === location.origin && /\.(?:js|css|woff2?|webp|png|svg)(?:\?|$)/i.test(url.pathname)) resources.add(url.pathname + url.search);
    } catch {}
  }
  await Promise.all([...resources].map((url) => cacheUrl(cache, url)));
}

export async function saveChapterOffline(novel: Novel, chapter: Chapter, mangaPages: MangaPage[] = []) {
  const storedChapter: Chapter = { ...chapter, pages: mangaPages.length ? mangaPages : chapter.pages };
  const storedNovel: Novel = { ...novel, reviews: [], chapters: [storedChapter], catalogueOnly: false };
  const cache = await caches.open(MEDIA_CACHE);
  await Promise.all([cacheApplicationShell(cache), ...mediaUrls(novel, storedChapter, mangaPages).map((url) => cacheUrl(cache, url))]);
  const record: OfflineChapterRecord = { id: `${novel.id}:${chapter.id}`, novel: storedNovel, chapter: storedChapter, downloadedAt: new Date().toISOString() };
  await transaction("readwrite", (store) => store.put(record));
  return record;
}

export async function removeChapterOffline(novelId: string, chapterId: string) {
  await transaction("readwrite", (store) => store.delete(`${novelId}:${chapterId}`));
}

export async function getOfflineNovel(novelId: string): Promise<Novel | null> {
  const rows = (await listOfflineChapters()).filter((row) => row.novel.id === novelId);
  if (!rows.length) return null;
  return { ...rows[0].novel, chapters: rows.map((row) => row.chapter).sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber)), reviews: [], catalogueOnly: false };
}

export async function getOfflineNovels(): Promise<Novel[]> {
  const rows = await listOfflineChapters();
  const ids = [...new Set(rows.map((row) => row.novel.id))];
  return (await Promise.all(ids.map(getOfflineNovel))).filter((novel): novel is Novel => !!novel);
}

