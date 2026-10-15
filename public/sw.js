// Service worker: keeps the app loadable offline and serves saved basemap tiles.
//  - App shell (same-origin): network first, cached copy when offline. Hashed assets are cached as they load.
//  - USGS topo tiles: cache first (filled by "Save this area for offline"; see src/lib/tiles.ts).
//  - Live data services (ArcGIS, NOAA, Overpass, geocoder): untouched, so regulations are never silently stale
//    online. Offline, the app answers from saved areas instead (src/lib/offline.ts).
const SHELL = 'shell-v1';
const TILES = 'usgs-tiles-v1'; // keep in sync with TILE_CACHE in src/lib/tiles.ts

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'basemap.nationalmap.gov') {
    e.respondWith(caches.open(TILES).then(c => c.match(req.url).then(hit => hit || fetch(req))));
    return;
  }
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req.mode === 'navigate' ? './' : req, res.clone());
      return res;
    } catch {
      return (await cache.match(req.mode === 'navigate' ? './' : req)) || (await cache.match('./')) || Response.error();
    }
  })());
});
