// App state <-> URL fragment, for shareable links. Pure functions: no DOM, so they're unit-tested.
//
//   #map=37.6234,-119.0012,12&tab=routes&pt=37.61,-119.0&water=lake&land=USFS.BLM&mapland=…
//    &f=min:3,max:30,water:400,trip:2026-07-04..2026-07-06,trout:keep,regs:any,sort:length,closed:1,hiker:1,public:1
//    &rland=USFS.BLM.NPS&route=usfs:{GUID}
//
// Defaults are omitted, so a fresh view's link is short. Unknown or malformed parts are ignored, never thrown on.
import type { OverlayId } from '../config';
import { ALL_LAND, PUBLIC_LAND } from './land';
import type { RouteFilters } from './trails';
import type { AgencyKey } from '../regs';
import type { LatLng, WaterSelection } from '../types';

export interface UrlState {
  map?: { lat: number; lng: number; zoom: number };
  tab?: 'check' | 'routes' | 'shore';
  point?: LatLng;
  water?: WaterSelection;
  mapLand?: AgencyKey[];
  overlays?: Partial<Record<OverlayId, boolean>>;
  filters?: Partial<RouteFilters>;
  route?: string;
}

const WATERS: WaterSelection[] = ['auto', 'stream', 'lake', 'ocean'];
const OVERLAY_IDS: OverlayId[] = ['land', 'regwaters', 'mpa', 'depth', 'rca'];
const KEYS = new Set<string>(ALL_LAND);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
const num = (s: string | undefined) => (s !== undefined && s !== '' && isFinite(+s) ? +s : undefined);
const isoDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const landList = (s: string | null) => (s === null ? undefined : s === '' ? [] : s.split('.').filter(k => KEYS.has(k)) as AgencyKey[]);

export function encodeState(s: UrlState, defaults: { filters: RouteFilters; overlays: Record<OverlayId, boolean> }): string {
  const p = new URLSearchParams();
  if (s.map) p.set('map', `${s.map.lat.toFixed(4)},${s.map.lng.toFixed(4)},${Math.round(s.map.zoom)}`);
  if (s.tab && s.tab !== 'check') p.set('tab', s.tab);
  if (s.point) p.set('pt', `${s.point.lat.toFixed(5)},${s.point.lng.toFixed(5)}`);
  if (s.water && s.water !== 'auto') p.set('water', s.water);
  if (s.overlays) {
    const changed = OVERLAY_IDS.filter(id => s.overlays![id] !== undefined && s.overlays![id] !== defaults.overlays[id]);
    if (changed.length) p.set('layers', changed.map(id => `${s.overlays![id] ? '+' : '-'}${id}`).join('.'));
  }
  if (s.mapLand && !sameSet(s.mapLand, ALL_LAND)) p.set('mapland', s.mapLand.join('.'));
  if (s.filters) {
    const f = s.filters, d = defaults.filters, parts: string[] = [];
    if (f.minMiles !== undefined && f.minMiles !== d.minMiles) parts.push(`min:${f.minMiles}`);
    if (f.maxMiles !== undefined && f.maxMiles !== d.maxMiles) parts.push(`max:${f.maxMiles}`);
    if (f.maxWaterMeters !== undefined && f.maxWaterMeters !== d.maxWaterMeters) parts.push(`water:${f.maxWaterMeters}`);
    // Trip dates are always written when present: a shared link means "these dates", not "today".
    if (f.tripStart && f.tripEnd) parts.push(`trip:${f.tripStart}..${f.tripEnd}`);
    if (f.trout && f.trout !== d.trout) parts.push(`trout:${f.trout}`);
    if (f.regs && f.regs !== d.regs) parts.push(`regs:${f.regs}`);
    if (f.sort && f.sort !== d.sort) parts.push(`sort:${f.sort}`);
    for (const [k, short] of [['excludeClosed', 'closed'], ['hikerOnly', 'hiker'], ['publicOnly', 'public']] as const)
      if (f[k] !== undefined && f[k] !== d[k]) parts.push(`${short}:${f[k] ? 1 : 0}`);
    if (parts.length) p.set('f', parts.join(','));
    if (f.landTypes && !sameSet(f.landTypes, PUBLIC_LAND)) p.set('rland', f.landTypes.join('.'));
  }
  if (s.route) p.set('route', s.route);
  // Keep separators readable in links.
  return p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%7B/g, '{').replace(/%7D/g, '}');
}

export function decodeState(hash: string): UrlState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: UrlState = {};
  const map = p.get('map')?.split(',').map(Number);
  if (map && map.length === 3 && map.every(isFinite) && Math.abs(map[0]) <= 90 && Math.abs(map[1]) <= 180)
    out.map = { lat: map[0], lng: map[1], zoom: Math.max(3, Math.min(19, map[2])) };
  const tab = p.get('tab');
  if (tab === 'routes' || tab === 'check' || tab === 'shore') out.tab = tab;
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
  const f: Partial<RouteFilters> = {};
  for (const part of (p.get('f') ?? '').split(',')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i), v = part.slice(i + 1);
    if (k === 'min' && num(v) !== undefined) f.minMiles = num(v);
    else if (k === 'max' && num(v) !== undefined) f.maxMiles = num(v);
    else if (k === 'water' && [100, 400, 800].includes(+v)) f.maxWaterMeters = +v;
    else if (k === 'trip') { const [a, b] = v.split('..'); if (isoDay(a) && isoDay(b)) { f.tripStart = a; f.tripEnd = b; } }
    else if (k === 'trout' && ['any', 'keep', 'release'].includes(v)) f.trout = v as RouteFilters['trout'];
    else if (k === 'regs' && ['any', 'special', 'general'].includes(v)) f.regs = v as RouteFilters['regs'];
    else if (k === 'sort' && ['length', 'waters'].includes(v)) f.sort = v as RouteFilters['sort'];
    else if (k === 'closed' && (v === '0' || v === '1')) f.excludeClosed = v === '1';
    else if (k === 'hiker' && (v === '0' || v === '1')) f.hikerOnly = v === '1';
    else if (k === 'public' && (v === '0' || v === '1')) f.publicOnly = v === '1';
  }
  const rland = landList(p.get('rland'));
  if (rland) f.landTypes = rland;
  if (Object.keys(f).length) out.filters = f;
  const route = p.get('route');
  if (route) out.route = route;
  return out;
}
