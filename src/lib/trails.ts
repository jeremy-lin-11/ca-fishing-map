// Backpacking route search: trails near fishable water in the current map view.
//
// All data is fetched once per search (USFS trails, OSM trails + waters, land and CDFW special-regulation
// polygons for the area) and matched locally, so a search costs a handful of requests, not one per water.
import { CONFIG } from '../config';
import { AGENCIES, type AgencyKey } from '../regs';
import type { Status } from '../types';
import { arcQuery, type Attrs } from './arcgis';
import { bboxSpanKm, lineLength, M_PER_MILE, nearestBetween, nearPairs, pointInPolygon, projector, type BBox, type Coord, type Line } from './geo';
import { http } from './http';
import { classifyOwnership, PUBLIC_LAND } from './land';
import { buildGroups, fetchRegRows, KINDS, resolveHits, type RegGroup } from './regdata';
import { districtScope, summarizeGroup, troutRule, type RegSummary, type TroutRule } from './rules';
import { daysBetween } from './season';
import { californiaQueryParams, inCalifornia } from './california';

export interface RouteFilters {
  minMiles: number;
  maxMiles: number;
  maxWaterMeters: number;
  landTypes: AgencyKey[];  // waters count only on land of these ownership types…
  publicOnly: boolean;     // …and (when true) not on unmapped, likely private land
  tripStart: string;       // YYYY-MM-DD; seasons and trout limits are evaluated for every day of the trip
  tripEnd: string;
  excludeClosed: boolean;  // drop waters closed to fishing on any trip day
  regs: 'any' | 'special' | 'general';
  hikerOnly: boolean;      // exclude trails open to motor vehicles
  trout: 'any' | 'keep' | 'release'; // keep = trout may be kept every day (bag > 0); release = catch-and-release only
  sort: 'length' | 'waters';
}
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const DEFAULT_FILTERS: RouteFilters = {
  minMiles: 3, maxMiles: 30, maxWaterMeters: 400, landTypes: PUBLIC_LAND, publicOnly: true, tripStart: isoDay(new Date()), tripEnd: isoDay(new Date()),
  excludeClosed: true, regs: 'any', hikerOnly: true, trout: 'any', sort: 'length'
};
const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const tripDays = (f: RouteFilters) => {
  const a = parseDay(f.tripStart), b = parseDay(f.tripEnd);
  return isNaN(+a) ? [new Date()] : daysBetween(a, isNaN(+b) || b < a ? a : b, 30);
};

// Filter-independent facts about a water near a trail (computed once per search).
export interface WaterBase {
  id: string;
  name: string;
  kind: 'lake' | 'stream';
  meters: number;     // closest approach to the trail
  at: Coord;          // access point on the water
  land: { name: string; key: AgencyKey } | null;
  rules: RegSummary[]; // special regulations (scope 'water') and relevant district rules
}
// ...plus what depends on the trip dates.
export interface WaterAccess extends WaterBase {
  trout: TroutRule;
  status: Status;     // ok = public & open, warn = check rules/access, no = closed or restricted
}
export interface Route {
  id: string;
  name: string;
  source: 'USFS' | 'OSM';
  miles: number;
  lengthNote: string;
  manager: string;
  motorized: boolean;
  lines: Line[];
  waters: WaterAccess[];
}
export interface SearchResult { routes: Route[]; considered: number; errors: string[]; notes: string[] }

// USFS Region 5 forest numbers (first 4 digits of managing_org, e.g. 050452 -> Inyo NF).
const R5_FORESTS: Record<string, string> = {
  '0501': 'Angeles NF', '0502': 'Cleveland NF', '0503': 'Eldorado NF', '0504': 'Inyo NF', '0505': 'Klamath NF',
  '0506': 'Lassen NF', '0507': 'Los Padres NF', '0508': 'Mendocino NF', '0509': 'Modoc NF', '0510': 'Six Rivers NF',
  '0511': 'Plumas NF', '0512': 'San Bernardino NF', '0513': 'Sequoia NF', '0514': 'Shasta-Trinity NF', '0515': 'Sierra NF',
  '0516': 'Stanislaus NF', '0517': 'Tahoe NF', '0519': 'Lake Tahoe Basin MU'
};

export function checkSearchArea(b: BBox): string | null {
  const { ns, ew } = bboxSpanKm(b);
  const max = CONFIG.trails.maxSearchKm;
  return ns > max || ew > max ? `Zoom in: the search area is ${Math.round(Math.max(ns, ew))} km across (max ${max} km).` : null;
}

// --- fetchers ---------------------------------------------------------------------------------

// Spatial filter for the search area, clipped to California (searches are already clipped to CA's bbox).
const envelope = (b: BBox) => californiaQueryParams(b) ?? {
  geometry: `${b.west},${b.south},${b.east},${b.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects'
};

// ArcGIS JSON polylines/polygons -> arrays of [lng, lat] lines (requires outSR=4326).
const paths = (g: any): Line[] => (g?.paths || g?.rings || []) as Line[];

async function arcFeatures(url: string, params: Record<string, string>, pages = 5): Promise<{ attributes: Attrs; geometry: any }[]> {
  const out: { attributes: Attrs; geometry: any }[] = [];
  for (let page = 0; page < pages; page++) {
    const body = new URLSearchParams({ f: 'json', returnGeometry: 'true', outSR: '4326', resultOffset: String(out.length), ...params });
    const j = await (await http(`${url}/query`, { method: 'POST', body })).json();
    if (j.error) throw new Error(j.error.message || 'ArcGIS query failed');
    out.push(...j.features);
    if (!j.exceededTransferLimit) break;
  }
  return out;
}

interface RawTrail { id: string; name: string; source: 'USFS' | 'OSM'; lines: Line[]; miles: number; lengthNote: string; manager: string; motorized: boolean }

async function fetchUsfsTrails(b: BBox): Promise<RawTrail[]> {
  const url = CONFIG.trails.usfs;
  const segs = await arcFeatures(url, { ...envelope(b), where: "trail_name IS NOT NULL AND trail_type = 'TERRA'", geometryPrecision: '5',
    outFields: 'trail_cn,trail_name,trail_no,managing_org,terra_motorized' });
  const by = new Map<string, RawTrail>();
  for (const { attributes: a, geometry } of segs) {
    const id = String(a.trail_cn);
    const t: RawTrail = by.get(id) ?? {
      id: `usfs:${id}`, name: titleCase(String(a.trail_name)) + (a.trail_no ? ` (#${a.trail_no})` : ''), source: 'USFS' as const,
      lines: [], miles: 0, lengthNote: 'Official USFS mileage, whole trail',
      manager: R5_FORESTS[String(a.managing_org || '').slice(0, 4)] || 'National Forest', motorized: false
    };
    t.lines.push(...paths(geometry));
    t.motorized ||= a.terra_motorized === 'Y';
    by.set(id, t);
  }
  // Segments outside the view aren't returned, so total mileage comes from a second, attribute-only query.
  const ids = [...by.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const rows = await arcQuery(url, { where: `trail_cn IN (${chunk.map(c => `'${c.replace(/'/g, "''")}'`).join(',')})`, outFields: 'trail_cn,gis_miles' });
    for (const r of rows) by.get(String(r.trail_cn))!.miles += Number(r.gis_miles) || 0;
  }
  return [...by.values()];
}

export interface RawWater { id: string; name: string; kind: 'lake' | 'stream'; lines: Line[] }

// One OSM way/relation, from either live Overpass JSON or a static tile.
interface OsmElement { id: string; name: string; trail: boolean; kind: 'lake' | 'stream'; tags: Record<string, string>; lines: Line[] }

function assembleOsm(elements: OsmElement[], lengthNote: string): { trails: RawTrail[]; waters: RawWater[] } {
  const trails = new Map<string, RawTrail>(), waters = new Map<string, RawWater>(), seen = new Set<string>();
  for (const el of elements) {
    if (seen.has(el.id) || !el.lines.length) continue; // ways crossing tile edges appear in both tiles
    seen.add(el.id);
    if (el.trail) {
      if (!isFootTrail({ ...el.tags, name: el.name })) continue;
      const key = normName(el.name);
      const t: RawTrail = trails.get(key) ?? { id: `osm:${key}`, name: el.name, source: 'OSM' as const, lines: [], miles: 0,
        lengthNote, manager: el.tags.operator || 'OpenStreetMap', motorized: false };
      t.lines.push(...el.lines);
      t.motorized ||= el.tags.motor === '1' || ['motor_vehicle', 'motorcycle', 'atv'].some(k => el.tags[k] === 'yes');
      trails.set(key, t);
    } else {
      const key = `${el.kind}:${normName(el.name)}`;
      const w: RawWater = waters.get(key) ?? { id: key, name: el.name, kind: el.kind, lines: [] };
      w.lines.push(...el.lines);
      waters.set(key, w);
    }
  }
  for (const t of trails.values()) t.miles = t.lines.reduce((s, l) => s + lineLength(l), 0) / M_PER_MILE;
  return { trails: [...trails.values()], waters: [...waters.values()] };
}

async function fetchOsmLive(b: BBox): Promise<{ trails: RawTrail[]; waters: RawWater[] }> {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:60];
(
  way["highway"~"^(path|footway|bridleway)$"]["name"]["footway"!="sidewalk"]["access"!="private"](${bb});
  way["natural"="water"]["name"]["water"!~"^(wastewater|basin|canal|fountain|pool)$"](${bb});
  relation["natural"="water"]["name"](${bb});
  way["waterway"~"^(river|stream)$"]["name"](${bb});
);
out geom;`;
  const j = await overpass(q);
  const elements: OsmElement[] = (j.elements as any[]).filter(el => el.tags?.name).map(el => ({
    id: `${el.type[0]}${el.id}`, name: el.tags.name, trail: !!el.tags.highway, kind: el.tags.waterway ? 'stream' : 'lake', tags: el.tags,
    lines: el.type === 'way' ? [el.geometry.map((p: any) => [p.lon, p.lat])]
      : (el.members || []).filter((m: any) => m.geometry).map((m: any) => m.geometry.map((p: any) => [p.lon, p.lat]))
  }));
  return assembleOsm(elements, 'Mapped OSM segments in this area');
}

// --- static tiles (scripts/extract-osm.mjs) ---
interface TileIndex { tile: number; tiles: Record<string, unknown>; osmBase: string | null }
let indexPromise: Promise<TileIndex | null> | null = null;
const loadIndex = () => (indexPromise ??= http(`${CONFIG.trails.staticOsm}/index.json`).then(r => r.json()).catch(() => null));

// [x0, y0, dx1, dy1, …] in 1e-5 degrees -> [[lng, lat], …]
export function decodeLine(enc: number[]): Line {
  const out: Line = []; let x = 0, y = 0;
  for (let i = 0; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; out.push([x / 1e5, y / 1e5]); }
  return out;
}

// Static tiles covering the box, or null if any are missing (then the caller queries Overpass live).
async function fetchOsmStatic(b: BBox): Promise<{ trails: RawTrail[]; waters: RawWater[]; osmBase: string | null } | null> {
  const index = await loadIndex();
  if (!index?.tile) return null;
  const T = index.tile, keys: string[] = [];
  for (let x = Math.floor((b.west + 180) / T); x <= Math.floor((b.east + 180) / T); x++)
    for (let y = Math.floor((b.south + 90) / T); y <= Math.floor((b.north + 90) / T); y++) keys.push(`${x}_${y}`);
  if (keys.some(k => !index.tiles[k])) return null;
  const tiles = await Promise.all(keys.filter(k => !(index.tiles[k] as { empty?: boolean }).empty) // open-ocean tiles: nothing to load
    .map(k => http(`${CONFIG.trails.staticOsm}/t/${k}.json`).then(r => r.json())));
  // Tiles are 0.5° squares; keep only what's in the searched view (plus a margin for waters near trails at its
  // edge), so results match "this map view" and the proximity work stays proportional to the view.
  const pad = 0.01; // ~1 km, > MAX_WATER_METERS
  const inView = (lines: Line[]) => lines.some(l => l.some(([x, y]) => x >= b.west - pad && x <= b.east + pad && y >= b.south - pad && y <= b.north + pad));
  const elements: OsmElement[] = tiles.flatMap((t: any) => [
    ...t.trails.map((e: any) => ({ id: e.i, name: e.n, trail: true, kind: 'stream' as const, tags: Object.fromEntries(Object.entries(e.t || {}).map(([k, v]) => [k, String(v)])), lines: e.l.map(decodeLine) })),
    ...t.waters.map((e: any) => ({ id: e.i, name: e.n, trail: false, kind: e.k, tags: {}, lines: e.l.map(decodeLine) }))
  ]).filter((e: OsmElement) => inView(e.lines));
  return { ...assembleOsm(elements, 'Mapped OSM segments in the loaded tiles'), osmBase: index.osmBase };
}

async function fetchOsm(b: BBox): Promise<{ trails: RawTrail[]; waters: RawWater[]; note: string }> {
  const fromTiles = await fetchOsmStatic(b).catch(() => null);
  if (fromTiles) return { ...fromTiles, note: `OpenStreetMap data from static extract${fromTiles.osmBase ? ` (${fromTiles.osmBase.slice(0, 10)})` : ''}` };
  if (!CONFIG.trails.liveFallback) throw new Error('OpenStreetMap trails and waters aren\'t available for this area yet');
  return { ...(await fetchOsmLive(b)), note: 'OpenStreetMap data queried live (no static tiles for this area)' };
}

// Overpass answers rate limits (429) and overload (504) with an HTML page, so a JSON parse failure
// means "busy": back off and retry a couple of times before giving up.
// Overpass frees a rate-limit slot some seconds after a query finishes, so back off generously.
async function overpass(query: string, delays = [5000, 15000, 30000]): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (await http(CONFIG.trails.overpass, { method: 'POST', body: new URLSearchParams({ data: query }) })).json();
    } catch (e) {
      if (attempt >= delays.length) throw new Error('OpenStreetMap (Overpass) is busy or rate-limited; try again in a minute');
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
}

export interface LandPoly { rings: Line[]; name: string; key: AgencyKey; attrs: Attrs } // attrs: Own_* (for offline point checks)

async function fetchLand(b: BBox): Promise<LandPoly[]> {
  const feats = await arcFeatures(CONFIG.layers.ownership.url, { ...envelope(b), where: '1=1', maxAllowableOffset: '0.0002', geometryPrecision: '5',
    outFields: 'Own_Level,Own_Group,Own_Agency' }, 10);
  return feats.map(f => { const [u] = classifyOwnership([f.attributes]); return { rings: paths(f.geometry), name: u.name, key: u.key, attrs: f.attributes }; });
}

// 'area' = tributary/drainage polygons ("X Lake and tributaries"), which apply to any water inside them.
// 'district' = §7.00 district general-regulation polygons.
export interface RegFeature { kind: 'lake' | 'stream' | 'area' | 'district'; code: string; desc: string; lines: Line[]; mapCode?: string; unverified?: boolean }
export interface RegData { features: RegFeature[]; groups: Map<string, RegGroup>; rows: Attrs[] } // rows: raw text rows (for offline point checks)

// allDistricts: every district/county polygon (for offline point checks), not just the §7.00 ones route search uses.
async function fetchRegFeatures(b: BBox, allDistricts = false): Promise<RegData> {
  const R = CONFIG.regs;
  const opts = { ...envelope(b), where: 'reg_number IS NOT NULL', outFields: 'feat_desc,reg_number', geometryPrecision: '5' };
  const [lakes, streams, areas, districts] = await Promise.all([
    arcFeatures(`${R.url}/${R.layers.lakes}`, opts), arcFeatures(`${R.url}/${R.layers.streams}`, opts),
    arcFeatures(`${R.url}/${R.layers.tributary}`, { ...opts, maxAllowableOffset: '0.0005' }),
    arcFeatures(`${R.url}/${R.layers.districts}`, { ...opts, where: allDistricts ? 'reg_number IS NOT NULL' : "reg_number LIKE '7.00(%'", maxAllowableOffset: '0.002' })
  ]);
  const mapped: RegFeature[] = [
    ...lakes.map(f => ({ kind: 'lake' as const, f })), ...streams.map(f => ({ kind: 'stream' as const, f })),
    ...areas.map(f => ({ kind: 'area' as const, f })), ...districts.map(f => ({ kind: 'district' as const, f }))
  ].map(({ kind, f }) => ({ kind, code: String(f.attributes.reg_number).trim(), desc: String(f.attributes.feat_desc || '').replace(/\[[a-z]\]/g, '').trim(), lines: paths(f.geometry) }));
  const features = mapped.length ? await resolveHits(R, mapped) : mapped;
  const groups = new Map<string, RegGroup>();
  let rows: Attrs[] = [];
  if (features.length) {
    const rowsByCode = await fetchRegRows(R, features.map(f => f.code));
    rows = [...rowsByCode.values()];
    const hits = features.map(f => ({ kind: KINDS[KIND_IDX[f.kind]], desc: f.desc, code: f.code }));
    for (const g of buildGroups({ hits, rowsByCode, failed: [] })) groups.set(g.code, g);
  }
  return { features, groups, rows };
}
export const KIND_IDX = { lake: 0, stream: 1, area: 2, district: 3 } as const;

// --- matching ---------------------------------------------------------------------------------

const REG_MATCH_M = 150;
const LAND_MATCH_M = 60; // ownership parcels often stop at the shoreline

// Bounding boxes (lng/lat) of land and regulation geometry, computed once per dataset, so each water check
// only does polygon/line math against shapes that are actually nearby.
type Bounds = [number, number, number, number]; // w, s, e, n
const boundsCache = new WeakMap<Line[], Bounds>();
function boundsOf(lines: Line[]): Bounds {
  let b = boundsCache.get(lines);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const l of lines) for (const [x, y] of l) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    boundsCache.set(lines, b);
  }
  return b;
}
const DEG_PAD = 0.003; // ~300 m, > REG_MATCH_M
const nearBox = ([x, y]: Coord, lines: Line[], pad = 0) => { const b = boundsOf(lines); return x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad; };

function assessWater(w: RawWater, at: Coord, land: LandPoly[], regs: RegData,
  proj: (c: Coord) => [number, number]): Omit<WaterBase, 'meters'> {
  const onLand = classifyOrder(land.filter(p => nearBox(at, p.rings, DEG_PAD) &&
    (pointInPolygon(at, p.rings) || nearestBetween([[at]], p.rings, proj, LAND_MATCH_M) !== null)));
  const rules: RegSummary[] = [];
  for (const f of regs.features) {
    if (!nearBox(at, f.lines, DEG_PAD)) continue;
    if (f.kind === 'district') {
      if (!f.code.startsWith('7.00(') || !pointInPolygon(at, f.lines)) continue; // other district rows (bass, hours…) aren't trout seasons
      const s = summarizeGroup(regs.groups.get(f.code), f, 'district-streams');
      const scope = districtScope(s);
      if (scope) rules.push({ ...s, scope });
      continue;
    }
    const applies = f.kind === 'area' ? pointInPolygon(at, f.lines)
      : f.kind === w.kind && ((f.kind === 'lake' && pointInPolygon(at, f.lines)) || nearestBetween([[at]], f.lines, proj, REG_MATCH_M) !== null);
    if (applies) rules.push(summarizeGroup(regs.groups.get(f.code), f, 'water'));
  }
  return { id: w.id, name: w.name, kind: w.kind, at, land: onLand ? { name: onLand.name, key: onLand.key } : null, rules };
}

// Status for a set of trip dates.
export function withTrip(w: WaterBase, days: Date[]): WaterAccess {
  const trout = troutRule(w.kind, w.rules, days);
  const ag = w.land ? AGENCIES[w.land.key] : null;
  const status: Status = trout.open === false || ag?.status === 'no' ? 'no'
    : !ag || ag.status === 'warn' || trout.open === null || trout.caveats.length || w.rules.some(r => r.scope === 'water') ? 'warn' : 'ok';
  return { ...w, trout, status };
}

// Most restrictive land unit wins (same rule as the point check).
function classifyOrder(polys: LandPoly[]): LandPoly | null {
  const order = { no: 3, warn: 2, ok: 1 };
  return polys.sort((a, b) => order[AGENCIES[b.key].status] - order[AGENCIES[a.key].status])[0] ?? null;
}

// Largest "water within" option in the UI; proximity is computed once up to this distance.
export const MAX_WATER_METERS = 800;

// The filter-independent (expensive) part of a search, done once per searched area:
// which waters come within MAX_WATER_METERS of which trails, and each water's access/regs/trout check.
// Plain data (no Maps of geometry, no functions), so it can be posted from the search Web Worker.
export interface Prepared {
  bbox: BBox;
  considered: number;
  errors: string[];
  notes: string[];
  near: { trail: RawTrail; waters: WaterBase[] }[]; // waters sorted by distance
}

export function prepareRouteData(d: RouteData): Prepared {
  const proj = projector((d.bbox.south + d.bbox.north) / 2);
  const trails = d.trails.filter(t => t.lines.length && t.lines.some(l => l.some(inCalifornia))); // e.g. Nevada side of Tahoe
  const pairs = nearPairs(trails.map(t => t.lines), d.waters.map(w => w.lines), proj, MAX_WATER_METERS);
  // A water passed by several trails usually has the same nearest access point; assess each point once.
  const assessed = new Map<string, Omit<WaterBase, 'meters'>>();
  const near = trails.map((trail, ti) => {
    const waters: WaterBase[] = [];
    for (const [wi, hit] of pairs.get(ti) ?? []) {
      if (!inCalifornia(hit.at)) continue; // CDFW rules only apply in California
      const w = d.waters[wi], key = `${w.id}@${hit.at[0]},${hit.at[1]}`;
      let a = assessed.get(key);
      if (!a) assessed.set(key, (a = assessWater(w, hit.at, d.land, d.regs, proj)));
      waters.push({ ...a, meters: hit.meters });
    }
    return { trail, waters: waters.sort((x, y) => x.meters - y.meters) };
  });
  return { bbox: d.bbox, considered: d.trails.length, errors: d.errors, notes: d.notes, near };
}

// Cheap: applies the filters (and trip dates) to prepared results; safe to run on every keystroke.
export function matchRoutes(p: Prepared, f: RouteFilters): Route[] {
  const days = tripDays(f);
  const routes: Route[] = [];
  for (const { trail: t, waters } of p.near) {
    if (t.miles < f.minMiles || t.miles > f.maxMiles || (f.hikerOnly && t.motorized)) continue;
    const keep: WaterAccess[] = [];
    for (const base of waters) {
      if (base.meters > f.maxWaterMeters) continue;
      if (base.land ? !f.landTypes.includes(base.land.key) : f.publicOnly) continue;
      const special = base.rules.some(r => r.scope === 'water');
      if (f.regs === 'special' && !special) continue;
      if (f.regs === 'general' && special) continue;
      const a = withTrip(base, days);
      if (f.excludeClosed && a.trout.open === false) continue;
      if (f.trout === 'keep' && a.trout.keep !== true) continue;
      if (f.trout === 'release' && !(a.trout.daily === 0 && a.trout.open !== false)) continue;
      keep.push(a);
    }
    if (keep.length) routes.push({ ...t, waters: keep });
  }
  return routes.sort((a, b) => f.sort === 'waters' ? b.waters.length - a.waters.length || a.miles - b.miles : a.miles - b.miles);
}

// Drop OSM trails that duplicate a USFS trail (USFS names are upper-case and cut at 30 chars).
export function dedupeTrails(usfs: RawTrail[], osm: RawTrail[]): RawTrail[] {
  const keys = usfs.map(t => normName(t.name.replace(/\s*\(#.*\)$/, '')));
  return [...usfs, ...osm.filter(o => {
    const k = normName(o.name);
    return !keys.some(u => u && (k.startsWith(u) || u.startsWith(k)));
  })];
}

// Everything a search needs for one map area. Filters are applied locally (filterRoutes), so changing
// a filter never re-downloads anything.
export interface RouteData {
  bbox: BBox;
  trails: RawTrail[];
  waters: RawWater[];
  land: LandPoly[];
  regs: RegData;
  errors: string[];
  notes: string[];
}

export async function fetchRouteData(b: BBox, opts: { allDistricts?: boolean } = {}): Promise<RouteData> {
  const errors: string[] = [];
  const soft = <T,>(p: Promise<T>, name: string, empty: T) =>
    p.catch((e: Error) => { errors.push(/busy|available/.test(e.message) ? e.message : name); return empty; });
  const [usfs, osm, land, regs] = await Promise.all([
    soft(fetchUsfsTrails(b), 'Forest Service trails', []),
    soft(fetchOsm(b), 'OpenStreetMap trails & waters', { trails: [], waters: [], note: '' }),
    soft(fetchLand(b), 'public land', []),
    soft(fetchRegFeatures(b, opts.allDistricts), 'CDFW special regulations', { features: [], groups: new Map(), rows: [] })
  ]);
  return { bbox: b, trails: dedupeTrails(usfs, osm.trails), waters: osm.waters, land, regs, errors, notes: osm.note ? [osm.note] : [] };
}

export const filterRoutes = (p: Prepared, f: RouteFilters): SearchResult =>
  ({ routes: matchRoutes(p, f), considered: p.considered, errors: p.errors, notes: p.notes });

export const searchRoutes = async (b: BBox, f: RouteFilters) => filterRoutes(prepareRouteData(await fetchRouteData(b)), f);

// --- helpers ----------------------------------------------------------------------------------

// OSM paths that aren't for walking: ski pistes, foot=no, and bike trails without foot access.
export const isFootTrail = (t: Record<string, string>) =>
  !t['piste:type'] && t.foot !== 'no' && !(t.bicycle === 'designated' && !['yes', 'designated', 'permissive'].includes(t.foot))
  && !/\b(bike|mtb)\b/i.test(t.name || '');

export const normName = (s: string) => s.toLowerCase().replace(/\btrail\b|\btr\b/g, '').replace(/[^a-z0-9]/g, '');
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/'S\b/g, "'s");
