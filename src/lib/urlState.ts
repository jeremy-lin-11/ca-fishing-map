// App state <-> URL fragment, for shareable links. Pure functions: no DOM, so they're unit-tested.
//
//   #map=37.6234,-119.0012,12&pt=37.61,-119.0&water=lake&layers=+rca.-depth&mapland=USFS.BLM
//
// Defaults are omitted, so a fresh view's link is short. Unknown or malformed parts (including the route-search
// parts of older links: tab, f, rland, route) are ignored, never thrown on.
import type { OverlayId } from '../config';
import { ALL_LAND } from './land';
import type { AgencyKey } from '../regs';
import type { LatLng, WaterSelection } from '../types';

export interface UrlState {
  map?: { lat: number; lng: number; zoom: number };
  point?: LatLng;
  water?: WaterSelection;
  mapLand?: AgencyKey[];
  overlays?: Partial<Record<OverlayId, boolean>>;
}

const WATERS: WaterSelection[] = ['auto', 'stream', 'lake', 'ocean'];
const OVERLAY_IDS: OverlayId[] = ['land', 'regwaters', 'mpa', 'depth', 'rca'];
const KEYS = new Set<string>(ALL_LAND);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
const landList = (s: string | null) => (s === null ? undefined : s === '' ? [] : s.split('.').filter(k => KEYS.has(k)) as AgencyKey[]);

export function encodeState(s: UrlState, defaults: { overlays: Record<OverlayId, boolean> }): string {
  const p = new URLSearchParams();
  if (s.map) p.set('map', `${s.map.lat.toFixed(4)},${s.map.lng.toFixed(4)},${Math.round(s.map.zoom)}`);
  if (s.point) p.set('pt', `${s.point.lat.toFixed(5)},${s.point.lng.toFixed(5)}`);
  if (s.water && s.water !== 'auto') p.set('water', s.water);
  if (s.overlays) {
    const changed = OVERLAY_IDS.filter(id => s.overlays![id] !== undefined && s.overlays![id] !== defaults.overlays[id]);
    if (changed.length) p.set('layers', changed.map(id => `${s.overlays![id] ? '+' : '-'}${id}`).join('.'));
  }
  if (s.mapLand && !sameSet(s.mapLand, ALL_LAND)) p.set('mapland', s.mapLand.join('.'));
  // Keep separators readable in links.
  return p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
}

export function decodeState(hash: string): UrlState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: UrlState = {};
  const map = p.get('map')?.split(',').map(Number);
  if (map && map.length === 3 && map.every(isFinite) && Math.abs(map[0]) <= 90 && Math.abs(map[1]) <= 180)
    out.map = { lat: map[0], lng: map[1], zoom: Math.max(3, Math.min(19, map[2])) };
  const pt = p.get('pt')?.split(',').map(Number);
  if (pt && pt.length === 2 && pt.every(isFinite)) out.point = { lat: pt[0], lng: pt[1] };
  const water = p.get('water') as WaterSelection | null;
  if (water && WATERS.includes(water)) out.water = water;
  const layers = p.get('layers');
  if (layers) {
    out.overlays = {};
    for (const t of layers.split('.')) {
      const id = t.slice(1) as OverlayId;
      if (OVERLAY_IDS.includes(id) && (t[0] === '+' || t[0] === '-' || t[0] === ' ')) out.overlays[id] = t[0] !== '-'; // '+' may arrive as ' '
    }
  }
  const mapLand = landList(p.get('mapland'));
  if (mapLand) out.mapLand = mapLand;
  return out;
}
