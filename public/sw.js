// Service worker: keeps the app loadable offline and serves saved basemap tiles.
//  - App shell (same-origin): precached on install from the build's file list (vite.config.ts writes BUILD and
//    PRECACHE into dist/sw.js), so the app opens offline even if it was only visited once. Then network first,
//    cached copy when offline. Each deploy changes BUILD, so a new worker installs and old shell caches are dropped.
//  - USGS topo tiles: cache first (filled by "Save this area for offline"; see src/lib/tiles.ts).
//  - Live data services (ArcGIS, NOAA, Overpass, geocoder): untouched, so regulations are never silently stale
//    online. Offline, the app answers from saved areas instead (src/lib/offline.ts).
const BUILD = 'dev';      // replaced at build time
const PRECACHE = [];      // replaced at build time: hashed JS/CSS, places.json, …
const SHELL = `shell-${BUILD}`;
const TILES = 'usgs-tiles-v1'; // keep in sync with TILE_CACHE in src/lib/tiles.ts

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', ...PRECACHE])));
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
      // Only page loads fall back to the app's HTML; a missing script must fail, not get HTML (a blank app).
      return (await cache.match(req.mode === 'navigate' ? './' : req)) || (req.mode === 'navigate' ? await cache.match('./') : undefined) || Response.error();
    }
  })());
});
