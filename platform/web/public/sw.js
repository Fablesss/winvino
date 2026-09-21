// Service worker PWA: оболочка приложения открывается без сети, API всегда идёт в сеть —
// распознавание без сервера невозможно, а кешировать ответы о чужих фото незачем.
// Регистрируется только в production и только вне Telegram (lib/pwa.ts).

const SHELL_CACHE = "winvino-shell-v1";
const STATIC_CACHE = "winvino-static-v1";
const SHELL_URL = "/";
const PRECACHE_URLS = [SHELL_URL, "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const currentCaches = new Set([SHELL_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => Promise.all(cacheNames.filter((name) => !currentCaches.has(name)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

/** Страница одна, поэтому любую навигацию храним под "/": свежая из сети, из кеша — только офлайн. */
async function respondToNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(SHELL_URL, response.clone());
    return response;
  } catch (networkError) {
    const cachedShell = await cache.match(SHELL_URL);
    if (cachedShell) return cachedShell;
    throw networkError;
  }
}

/** Файлы /_next/static/ с хешем в имени не меняются — сеть нужна только в первый раз. */
async function respondFromCacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(respondToNavigation(request));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(respondFromCacheFirst(request));
  }
});
