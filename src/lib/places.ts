// Place search over public/places.json (scripts/build-places.mjs): California towns + named lakes, streams, trails.
import { CONFIG } from '../config';
import { haversine } from './geo';
import { http } from './http';
import type { LatLng } from '../types';

export type PlaceKind = 'town' | 'lake' | 'stream' | 'trail';
export interface Place { name: string; kind: PlaceKind; lat: number; lng: number; pop: number; norm: string; words: string[] }
export interface PlaceHit extends Place { near?: string } // nearest town, to tell same-named places apart

// Lowercase, accents removed ("Peñasquitos" -> "penasquitos"), punctuation to spaces.
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const toPlaces = (rows: [string, PlaceKind, number, number, number?][]): Place[] =>
  rows.map(([name, kind, lat, lng, pop]) => { const norm = normalize(name); return { name, kind, lat, lng, pop: pop ?? 0, norm, words: norm.split(' ') }; });

let cache: Promise<Place[]> | null = null;
export const loadPlaces = () => (cache ??= http(CONFIG.places).then(r => r.json()).then(j => toPlaces(j.places)).catch(e => { cache = null; throw e; }));

const KIND_RANK: Record<PlaceKind, number> = { town: 0, lake: 1, stream: 2, trail: 3 };
const ZOOM: Record<PlaceKind, number> = { town: 12, lake: 14, stream: 13, trail: 13 };
export const zoomFor = (k: PlaceKind) => ZOOM[k];

export function searchPlaces(places: Place[], query: string, near?: LatLng, limit = 8): PlaceHit[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const qWords = q.split(' ');
  const scored: { p: Place; score: number }[] = [];
  for (const p of places) {
    // Every query word must prefix some word of the name ("twin lak" matches "Twin Lakes").
    if (!qWords.every(w => p.words.some(x => x.startsWith(w)))) continue;
    const score = p.norm === q ? 0 : p.norm.startsWith(q) ? 1 : 2;
    scored.push({ p, score });
  }
  const dist = (p: Place) => (near ? haversine([near.lng, near.lat], [p.lng, p.lat]) : 0);
  scored.sort((a, b) => a.score - b.score || KIND_RANK[a.p.kind] - KIND_RANK[b.p.kind] || b.p.pop - a.p.pop || dist(a.p) - dist(b.p) || a.p.name.localeCompare(b.p.name));
  const towns = places.filter(p => p.kind === 'town');
  return scored.slice(0, limit).map(({ p }) => {
    if (p.kind === 'town') return p;
    let best: Place | null = null, bd = Infinity;
    for (const t of towns) { const d = haversine([p.lng, p.lat], [t.lng, t.lat]); if (d < bd) { bd = d; best = t; } }
    return { ...p, near: best ? `${bd < 3000 ? 'in' : `${Math.round(bd / 1609)} mi from`} ${best.name}` : undefined };
  });
}
