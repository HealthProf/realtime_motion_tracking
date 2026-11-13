// Offline support. Everything the app has loaded once (including the pose model you used) is kept
// in a versioned cache so it works without a network afterwards.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `motion-lab-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('motion-lab-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const put = (res) => { if (res.ok && res.status === 200) cache.put(req, res.clone()); return res; };
    if (req.mode === 'navigate') {
      // Pages: network first so updates arrive, cache when offline.
      try { return put(await fetch(req)); } catch { return (await cache.match(req, { ignoreSearch: true })) || Response.error(); }
    }
    // Hashed assets, models and the WASM runtime never change within a version: cache first.
    return (await cache.match(req)) || put(await fetch(req));
  })());
});
