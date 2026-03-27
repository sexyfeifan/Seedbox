const CACHE_NAME = "seedbox-app-v12";
const APP_SHELL = [
  "/app",
  "/app/main.css",
  "/app/main.js",
  "/app/manifest.webmanifest",
  "/app/icon-192.svg",
  "/app/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }
  if (url.pathname.startsWith("/v1/")) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/app")) {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) {
    return hit;
  }
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(request);
    if (hit) {
      return hit;
    }
    return new Response(JSON.stringify({ message: "offline" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
