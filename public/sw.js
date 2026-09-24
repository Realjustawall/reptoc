const SHELL_CACHE = "reptoc-shell-v3";
const RUNTIME_CACHE = "reptoc-runtime-v3";
const MEDIA_CACHE = "reptoc-offline-media-v1";
const CORE = ["/", "/manifest.webmanifest", "/logo-128.webp", "/fonts/Estedad-Variable.woff2"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("reptoc-") && ![SHELL_CACHE, RUNTIME_CACHE, MEDIA_CACHE].includes(key)).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => { const copy = response.clone(); caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy)); return response; }).catch(() => caches.match("/").then((response) => response || Response.error())));
    return;
  }
  const isBuildAsset = url.pathname.startsWith("/assets/") && /\.(?:js|css)$/.test(url.pathname);
  if (isBuildAsset) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)); }
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || Response.error())));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && /\.(?:woff2?|png|jpe?g|webp|gif|svg)(?:$|\?)/i.test(url.pathname)) { const copy = response.clone(); caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)); }
    return response;
  })));
});
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "اعلان جدید رپتوک", body: event.data?.text() || "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "رپتوک", { body: data.body || "اعلان جدیدی دارید.", icon: data.icon || "/logo-128.webp", badge: "/logo-128.webp", tag: data.tag || "reptoc-notification", data: { url: data.url || "/notifications" }, dir: "rtl", lang: "fa" }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) if ("focus" in client) { client.navigate(target); return client.focus(); }
    return clients.openWindow(target);
  }));
});
