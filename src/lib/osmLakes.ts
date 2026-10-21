// "Which OpenStreetMap lake is this point in?" from public/lakes/ (scripts/build-lakes.mjs), one small file per
// 0.5° tile, loaded on demand and cached. A fallback where Esri/NHD water bodies has no lake at a point.
import { CONFIG } from '../config';
import { pointInPolygon, type BBox, type Line } from './geo';
import { http } from './http';
import type { LatLng } from '../types';

export interface OsmLake { name: string; rings: Line[] }
interface Index { tile: number; tiles: string[] }

const decode = (enc: number[]): Line => {
  const out: Line = []; let x = 0, y = 0;
  for (let i = 0; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; out.push([x / 1e5, y / 1e5]); }
  return out;
};

let indexP: Promise<Index> | null = null;
const tileP = new Map<string, Promise<OsmLake[]>>();
const loadIndex = () => (indexP ??= http(`${CONFIG.osmLakes}/index.json`).then(r => r.json()).catch(e => { indexP = null; throw e; }));
function loadTile(key: string): Promise<OsmLake[]> {
  let p = tileP.get(key);
  if (!p) {
    p = http(`${CONFIG.osmLakes}/${key}.json`).then(r => r.json())
      .then((j: { lakes: [string, number[][]][] }) => j.lakes.map(([name, rs]) => ({ name, rings: rs.map(decode) })));
    p.catch(() => tileP.delete(key));
    tileP.set(key, p);
  }
  return p;
}
const keysFor = (b: BBox, T: number) => {
  const keys: string[] = [];
  for (let x = Math.floor((b.west + 180) / T); x <= Math.floor((b.east + 180) / T); x++)
    for (let y = Math.floor((b.south + 90) / T); y <= Math.floor((b.north + 90) / T); y++) keys.push(`${x}_${y}`);
  return keys;
};

// Lakes whose outline touches the box (for offline areas).
export async function osmLakesIn(b: BBox): Promise<OsmLake[]> {
  const idx = await loadIndex();
  const keys = keysFor(b, idx.tile).filter(k => idx.tiles.includes(k));
  const seen = new Set<string>(), out: OsmLake[] = [];
  for (const lakes of await Promise.all(keys.map(loadTile)))
    for (const l of lakes) {
      const id = `${l.name}@${l.rings[0][0]}`; // lakes crossing a tile edge are in both tiles
      if (seen.has(id) || !l.rings.some(r => r.some(([x, y]) => x >= b.west && x <= b.east && y >= b.south && y <= b.north))) continue;
      seen.add(id); out.push(l);
    }
  return out;
}

export async function osmLakeAt(p: LatLng): Promise<{ NAME: string }[]> {
  const idx = await loadIndex();
  const [key] = keysFor({ south: p.lat, west: p.lng, north: p.lat, east: p.lng }, idx.tile);
  if (!idx.tiles.includes(key)) return [];
  const hit = (await loadTile(key)).find(l => pointInPolygon([p.lng, p.lat], l.rings));
  return hit ? [{ NAME: hit.name }] : [];
}
