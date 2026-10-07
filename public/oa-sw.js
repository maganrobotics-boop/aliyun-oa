"use strict";
const CACHE_PREFIX = "oa-pwa-static-";
const CACHE_NAME = CACHE_PREFIX + "v2";
const VERSIONED_ASSET_PATH = /^\/pwa\/(?:icon-192|icon-512|icon-maskable-512|apple-touch-icon-180)-v2\.png$/u;
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode === "navigate" || request.headers.has("range") ||
      url.origin !== self.location.origin || url.search || !VERSIONED_ASSET_PATH.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok && response.type === "basic" && !response.redirected &&
        /^image\/png(?:;|$)/i.test(response.headers.get("content-type") || "") &&
        !/no-store|private/i.test(response.headers.get("cache-control") || "")) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
