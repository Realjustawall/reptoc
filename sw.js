// Source copy of the public cleanup worker. See public/sw.js.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.registration.unregister().then(() => self.clients.claim()));
});
