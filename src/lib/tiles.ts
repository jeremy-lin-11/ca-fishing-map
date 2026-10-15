// Basemap tiles for offline areas (USGS National Map topo; public domain, so caching for offline use is fine).
import { BASEMAPS } from '../config';
import type { BBox } from './geo';

export const TILE_CACHE = 'usgs-tiles-v1'; // must match public/sw.js
const lng2x = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);

// Tile URLs covering the box from zMin to zMax, lowering zMax until there are at most maxTiles.
export function tileUrls(b: BBox, zMin = 8, zMax = 14, maxTiles = 4000): { urls: string[]; zMax: number } {
  for (let top = zMax; top >= zMin; top--) {
    const urls: string[] = [];
    for (let z = zMin; z <= top; z++)
      for (let x = lng2x(b.west, z); x <= lng2x(b.east, z); x++)
        for (let y = lat2y(b.north, z); y <= lat2y(b.south, z); y++)
          urls.push(BASEMAPS.usgsTopo.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x)));
    if (urls.length <= maxTiles) return { urls, zMax: top };
  }
  return { urls: [], zMax: zMin - 1 };
}

// Downloads tiles into Cache Storage (served offline by the service worker). Skips ones already cached.
export async function cacheTiles(urls: string[], onProgress: (done: number, total: number) => void, concurrency = 6): Promise<number> {
  const cache = await caches.open(TILE_CACHE);
  let next = 0, done = 0, bytes = 0, failed = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        if (!(await cache.match(url))) {
          const r = await fetch(url, { mode: 'cors' });
          if (r.ok) { bytes += (await r.clone().blob()).size; await cache.put(url, r); } else failed++;
        }
      } catch { failed++; }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failed > urls.length * 0.1) throw new Error(`${failed} of ${urls.length} basemap tiles failed to download`);
  return bytes;
}

// Removes tiles no other saved area still uses.
export async function uncacheTiles(urls: string[], keep: Set<string>) {
  const cache = await caches.open(TILE_CACHE);
  await Promise.all(urls.filter(u => !keep.has(u)).map(u => cache.delete(u)));
}
