/* =========================================================
   Service Worker — Offline cache for static assets
   - Cache-first for app shell
   - Network falling back to cache for navigation
   ========================================================= */

const CACHE_NAME = 'garment-costing-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Handle navigations (SPA-like)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', net.clone());
        return net;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./index.html')) || (await cache.match('./'));
      }
    })());
    return;
  }

  // Cache-first for other GET requests
  if (req.method === 'GET') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        // Only cache basic same-origin requests
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        return cached || Response.error();
      }
    })());
  }
});
