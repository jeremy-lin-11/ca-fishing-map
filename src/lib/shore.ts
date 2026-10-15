// Shore spots: where to fish for rockfish from shore. Rocky shoreline (CDFW shoreline types) near public access
// (Coastal Commission access points, or OSM trails reaching the rocks on public land), rated for how hard the
// shoreline is to reach (bluff height from NOAA elevation, mapped paths/stairs) and checked against MPAs.
// Difficulty is information, never a filter by default: some hard cliffs are the best spots.
import { CONFIG } from '../config';
import { AGENCIES, MPA_TYPES } from '../regs';
import type { Status } from '../types';
import { arcFeatures, envelopeFor, fetchLand, fetchOsm, type LandPoly } from './trails';
import { haversine, nearestBetween, nearPairs, pointInPolygon, projector, type BBox, type Coord, type Line } from './geo';
import { http } from './http';
import { inCalifornia } from './california';
import type { Attrs } from './arcgis';

// CDFW shoreline type codes (NOAA ESI) that hold rockfish habitat, grouped by how you'd fish them.
export type RockKind = 'platform' | 'talus' | 'cliff' | 'sheltered' | 'structure';
const ROCK_CODES: Record<string, RockKind> = {
  '2': 'platform', '2A': 'platform',   // wave-cut rocky platforms: low benches at the water
  '1C': 'talus',                        // rocky cliffs with a boulder talus base
  '1A': 'cliff',                        // exposed rocky cliffs
  '8': 'sheltered', '8A': 'sheltered',  // sheltered rocky shores
  '6B': 'structure', '6D': 'structure', '8C': 'structure' // riprap, boulder rubble (jetties, breakwaters)
};
export const ROCK_LABEL: Record<RockKind, string> = {
  platform: 'wave-cut rock platform', talus: 'cliff with boulder base', cliff: 'rocky cliff',
  sheltered: 'sheltered rocky shore', structure: 'riprap / jetty'
};
// Habitat weight per meter of shoreline.
const ROCK_WEIGHT: Record<RockKind, number> = { platform: 1, talus: 1, cliff: 0.9, sheltered: 0.8, structure: 0.7 };

export const HABITAT_RADIUS_M = 500;
const TRAIL_REACH_M = 150; // an OSM trail this close to rock counts as access

export type Difficulty = 'easy' | 'moderate' | 'hard';
export interface ShoreSpot {
  id: string;
  name: string;
  source: 'access point' | 'trail';
  at: Coord;              // the access point (or where the trail is closest to the rock)
  rockAt: Coord;          // nearest rocky shoreline point
  rockMeters: number;     // distance from access to that rock
  habitat: { score: number; meters: Partial<Record<RockKind, number>> }; // rocky shoreline within HABITAT_RADIUS_M
  bluffM: number | null;  // rise from the waterline within ~60 m inland (null: elevation unavailable)
  sheer: boolean;         // steeper than ~45° somewhere on that rise
  pathDown: boolean | null; // mapped stairs/path to the water (null: unknown, e.g. trail access)
  difficulty: Difficulty;
  difficultyWhy: string;
  mpa: { name: string; type: string; status: Status; text: string; allowed?: string } | null;
  groundfishArea: string;
  closed: string | null;  // access point closure note
  publicLand: string | null;
  features: { parking?: boolean; fee?: boolean; stairs?: boolean; path?: boolean; blufftopTrail?: boolean; wheelchair?: boolean;
    fishing?: boolean; tidepools?: boolean; restrooms?: boolean };
  description?: string;
  directionsUrl?: string;
}

export interface ShoreFilters {
  difficulty: Difficulty[];
  showNoTake: boolean;     // include spots inside no-take MPAs (for reference; fishing not allowed)
  includeTrails: boolean;  // OSM trail access, not just official access points
  parking: boolean;
  wheelchair: boolean;
  hideClosed: boolean;
  sort: 'habitat' | 'easiest';
}
export const DEFAULT_SHORE_FILTERS: ShoreFilters = {
  difficulty: ['easy', 'moderate', 'hard'], showNoTake: false, includeTrails: true, parking: false, wheelchair: false, hideClosed: true, sort: 'habitat'
};

export interface ShoreResult { bbox: BBox; spots: ShoreSpot[]; rock: { kind: RockKind; lines: Line[] }[]; errors: string[] }

// CDFW recreational groundfish management areas (ds3143), by latitude; SF Bay is checked by polygon first.
const GROUNDFISH_BANDS: [number, string][] = [[40 + 10 / 60, 'Northern'], [38 + 57.5 / 60, 'Mendocino'], [37 + 11 / 60, 'San Francisco'], [34 + 27 / 60, 'Central'], [-90, 'Southern']];
export const groundfishAreaAt = (lat: number) => GROUNDFISH_BANDS.find(([min]) => lat >= min)![1];

const yes = (v: unknown) => String(v ?? '').trim().toLowerCase() === 'yes';
const paths = (g: any): Line[] => (g?.paths || g?.rings || []) as Line[];

// --- difficulty ---------------------------------------------------------------------------------

export function rateDifficulty(bluffM: number | null, sheer: boolean, pathDown: boolean | null, kind: RockKind): { difficulty: Difficulty; why: string } {
  const h = bluffM === null ? 'height unknown' : `~${Math.round(bluffM)} m bluff`;
  const path = pathDown === true ? 'mapped path or stairs down' : pathDown === false ? 'no mapped path down' : 'path down unknown';
  const why = `${h}${sheer ? ', sheer' : ''}; ${path}; ${ROCK_LABEL[kind]}`;
  const lowEasyKind = kind === 'platform' || kind === 'structure';
  if (bluffM !== null) {
    if (bluffM >= 15 || (sheer && pathDown !== true) || (bluffM >= 5 && pathDown === false)) return { difficulty: 'hard', why };
    if (bluffM < 5 && (pathDown === true || lowEasyKind)) return { difficulty: 'easy', why };
    return { difficulty: 'moderate', why };
  }
  // No elevation: judge by rock type and path.
  if (kind === 'cliff' && pathDown !== true) return { difficulty: 'hard', why };
  if (lowEasyKind && pathDown === true) return { difficulty: 'easy', why };
  return { difficulty: 'moderate', why };
}

// Rise from the waterline: samples at these distances inland (m), toward the access point.
const TRANSECT_M = [0, 10, 20, 30, 45, 60];
export function bluffFrom(elev: (number | null)[]): { bluffM: number | null; sheer: boolean } {
  const vals = elev.map((v, i) => (v === null || !isFinite(v) ? null : { v, d: TRANSECT_M[i] })).filter((x): x is { v: number; d: number } => !!x);
  if (vals.length < 3) return { bluffM: null, sheer: false };
  const base = Math.max(0, Math.min(vals[0].v, vals[1]?.v ?? vals[0].v)); // waterline (DEM may read slightly negative)
  const top = Math.max(...vals.map(x => x.v));
  let sheer = false;
  for (let i = 1; i < vals.length; i++) if ((vals[i].v - vals[i - 1].v) / (vals[i].d - vals[i - 1].d) > 1) sheer = true; // > 45°
  return { bluffM: Math.max(0, top - base), sheer };
}

function transect(rock: Coord, toward: Coord): Coord[] {
  const proj = projector(rock[1]);
  const [x0, y0] = proj(rock), [x1, y1] = proj(toward);
  let dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  const kx = 111320 * Math.cos(rock[1] * Math.PI / 180), ky = 110540;
  return TRANSECT_M.map(d => [rock[0] + (dx * d) / kx, rock[1] + (dy * d) / ky] as Coord);
}

// One NOAA request for every spot's transect.
async function sampleElevations(pts: Coord[]): Promise<(number | null)[]> {
  const out: (number | null)[] = new Array(pts.length).fill(null);
  for (let i = 0; i < pts.length; i += 1000) {
    const chunk = pts.slice(i, i + 1000);
    const body = new URLSearchParams({ geometry: JSON.stringify({ points: chunk, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', f: 'json' });
    const j = await (await http(`${CONFIG.depth.dem}/getSamples`, { method: 'POST', body })).json();
    if (j.error) throw new Error(j.error.message || 'elevation service error');
    for (const s of j.samples ?? []) { const v = parseFloat(s.value); out[i + s.locationId] = isNaN(v) ? null : v; }
  }
  return out;
}

// --- search ------------------------------------------------------------------------------------

interface RockLine { kind: RockKind; line: Line }

export async function findShoreSpots(b: BBox): Promise<ShoreResult> {
  const errors: string[] = [];
  const soft = <T,>(p: Promise<T>, name: string, empty: T) => p.catch(() => { errors.push(name); return empty; });
  const S = CONFIG.shore;
  const codes = Object.keys(ROCK_CODES).map(c => `'${c}'`).join(',');
  const [access, shoreline, mpas, land, osm, bay] = await Promise.all([
    soft(arcFeatures(S.access, { ...envelopeFor(b), where: '1=1', outFields: '*' }), 'coastal access points', []),
    soft(arcFeatures(S.shoreline, { ...envelopeFor(b), where: `shoretype_1 IN (${codes}) OR shoretype_2 IN (${codes}) OR shoretype_3 IN (${codes})`,
      outFields: 'shoretype_1,shoretype_2,shoretype_3', geometryPrecision: '5' }), 'shoreline types', []),
    soft(arcFeatures(CONFIG.layers.mpa.url, { ...envelopeFor(b), where: '1=1', outFields: 'name,fullname,type,regulation_text', geometryPrecision: '5' }), 'MPAs', []),
    soft(fetchLand(b), 'land ownership', [] as LandPoly[]),
    soft(fetchOsm(b), 'OpenStreetMap trails', { trails: [], waters: [], note: '' }),
    soft(arcFeatures(S.groundfish, { where: "Region = 'SF Bay'", outFields: 'Region', geometryPrecision: '4', maxAllowableOffset: '0.002' }), 'groundfish areas', [])
  ]);

  const rocks: RockLine[] = [];
  for (const f of shoreline) {
    const a = f.attributes;
    const kinds = [a.shoretype_1, a.shoretype_2, a.shoretype_3].map((c: unknown) => ROCK_CODES[String(c ?? '').trim()]).filter(Boolean) as RockKind[];
    if (!kinds.length) continue;
    const kind = kinds.sort((x, y) => ROCK_WEIGHT[y] - ROCK_WEIGHT[x])[0];
    for (const line of paths(f.geometry)) if (line.length > 1) rocks.push({ kind, line });
  }
  const proj = projector((b.south + b.north) / 2);
  const bayRings = bay.flatMap(f => paths(f.geometry));

  // Candidate access points: official ones, plus OSM trails reaching the rock on public land.
  type Cand = Omit<ShoreSpot, 'rockAt' | 'rockMeters' | 'habitat' | 'bluffM' | 'sheer' | 'difficulty' | 'difficultyWhy' | 'mpa' | 'groundfishArea' | 'publicLand'> & { kindHint?: RockKind };
  const cands: Cand[] = [];
  for (const f of access) {
    const a: Attrs = f.attributes, at: Coord = [f.geometry?.x ?? +a.LONGITUDE, f.geometry?.y ?? +a.LATITUDE];
    if (!isFinite(at[0]) || !isFinite(at[1]) || yes(a.Archived)) continue;
    const closedNote = [String(a.Date_Closd ?? '').trim() && `Closed ${String(a.Date_Closd).trim()}`, String(a.ClosureCom ?? '').trim()].filter(Boolean).join(': ');
    cands.push({
      id: `ccc:${a.OBJECTID ?? a.Index_}`, name: String(a.Name || 'Coastal access'), source: 'access point', at,
      pathDown: yes(a.STRS_BEACH) || yes(a.PTH_BEACH) ? true : String(a.STRS_BEACH ?? '').trim() || String(a.PTH_BEACH ?? '').trim() ? false : null,
      closed: closedNote || null,
      features: { parking: yes(a.PARKING), fee: yes(a.FEE), stairs: yes(a.STRS_BEACH), path: yes(a.PTH_BEACH), blufftopTrail: yes(a.BLFTP_TRLS),
        wheelchair: yes(a.DSABLDACSS), fishing: yes(a.FISHING), tidepools: yes(a.TIDEPOOL), restrooms: yes(a.RESTROOMS) },
      description: String(a.Description || a.Location || '').trim() || undefined,
      directionsUrl: /^https?:/.test(String(a.GoogleMaps_Directions ?? '')) ? String(a.GoogleMaps_Directions) : undefined
    });
  }
  // Grid-indexed proximity (geo.nearPairs): rock lines vs trails; `at` is the nearest trail vertex.
  const rockSets = rocks.map(r => [r.line]);
  const trailHits = nearPairs(rockSets, osm.trails.map(t => t.lines), proj, TRAIL_REACH_M, 0);
  const bestByTrail = new Map<number, { meters: number; at: Coord }>();
  for (const m of trailHits.values()) for (const [ti, hit] of m) {
    const cur = bestByTrail.get(ti);
    if (!cur || hit.meters < cur.meters) bestByTrail.set(ti, hit);
  }
  for (const [ti, best] of bestByTrail) {
    const t = osm.trails[ti];
    cands.push({ id: `trail:${t.id}`, name: t.name, source: 'trail', at: best.at, pathDown: best.meters <= 30 ? true : null, closed: null, features: {} });
  }

  // Assess: nearest rock, habitat within the radius, MPA, land, groundfish area.
  const inCA = cands.filter(c => inCalifornia(c.at));
  // Candidate points vs rock lines within the habitat radius; `at` is the nearest rock vertex.
  const rockHits = nearPairs(inCA.map(c => [[c.at]]), rockSets, proj, HABITAT_RADIUS_M, 0);
  const assessed = inCA.map((c, ci) => {
    let near: { meters: number; at: Coord; kind: RockKind } | null = null;
    const meters: Partial<Record<RockKind, number>> = {};
    for (const [ri, hit] of rockHits.get(ci) ?? []) {
      const r = rocks[ri];
      if (!near || hit.meters < near.meters) near = { ...hit, kind: r.kind };
      // Length of this rocky line inside the radius (sum of segments whose midpoint is within it).
      for (let i = 1; i < r.line.length; i++) {
        const mid: Coord = [(r.line[i - 1][0] + r.line[i][0]) / 2, (r.line[i - 1][1] + r.line[i][1]) / 2];
        if (haversine(mid, c.at) <= HABITAT_RADIUS_M) meters[r.kind] = (meters[r.kind] ?? 0) + haversine(r.line[i - 1], r.line[i]);
      }
    }
    return near ? { c, near, meters } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);

  // Trail candidates that duplicate an official access point (same rock, nearby) add nothing.
  const official = assessed.filter(x => x.c.source === 'access point');
  const deduped = assessed.filter(x => x.c.source === 'access point' || !official.some(o => haversine(o.near.at, x.near.at) < 300));

  const elevations = await soft(sampleElevations(deduped.flatMap(x => transect(x.near.at, x.c.at))), 'elevation (bluff heights)', []);

  const spots: ShoreSpot[] = deduped.flatMap((x, i): ShoreSpot[] => {
    const { c, near, meters } = x;
    const { bluffM, sheer } = elevations.length ? bluffFrom(elevations.slice(i * TRANSECT_M.length, (i + 1) * TRANSECT_M.length)) : { bluffM: null, sheer: false };
    const { difficulty, why } = rateDifficulty(bluffM, sheer, c.pathDown, near.kind);
    const score = Object.entries(meters).reduce((s, [k, m]) => s + ROCK_WEIGHT[k as RockKind] * (m ?? 0), 0)
      * (c.features.fishing ? 1.15 : 1) * (c.features.tidepools ? 1.05 : 1);
    const mpaF = mpas.find(m => pointInPolygon(near.at, paths(m.geometry)) || nearestBetween([[near.at]], paths(m.geometry), proj, 30) !== null);
    let mpa: ShoreSpot['mpa'] = null;
    if (mpaF) {
      const a = mpaF.attributes, type = String(a.type ?? '');
      const m = MPA_TYPES.find(t => t.match.test(type))!;
      mpa = { name: String(a.fullname || a.name), type, status: m.status, text: m.text, allowed: String(a.regulation_text ?? '').trim() || undefined };
    }
    const onLand = land.find(p => pointInPolygon(c.at, p.rings) || nearestBetween([[c.at]], p.rings, proj, 60) !== null);
    // Trail access only counts on public land; official access points are public by definition.
    if (c.source === 'trail' && !(onLand && AGENCIES[onLand.key].public)) return [];
    const groundfishArea = bayRings.length && pointInPolygon(near.at, bayRings) ? 'SF Bay' : groundfishAreaAt(near.at[1]);
    return [{ ...c, rockAt: near.at, rockMeters: near.meters, habitat: { score, meters }, bluffM, sheer, difficulty, difficultyWhy: why, mpa,
      groundfishArea, publicLand: c.source === 'access point' ? 'Public coastal access' : `${onLand!.name} (${AGENCIES[onLand!.key].name})` }];
  });

  const byKind = new Map<RockKind, Line[]>();
  for (const r of rocks) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.line]);
  return { bbox: b, spots, rock: [...byKind].map(([kind, lines]) => ({ kind, lines })), errors };
}

const DIFF_RANK: Record<Difficulty, number> = { easy: 0, moderate: 1, hard: 2 };

export function filterSpots(r: ShoreResult, f: ShoreFilters): ShoreSpot[] {
  return r.spots.filter(s =>
    f.difficulty.includes(s.difficulty)
    && (f.showNoTake || s.mpa?.status !== 'no')
    && (f.includeTrails || s.source === 'access point')
    && (!f.parking || s.features.parking)
    && (!f.wheelchair || s.features.wheelchair)
    && (!f.hideClosed || !s.closed))
    .sort((a, b) => f.sort === 'easiest' ? DIFF_RANK[a.difficulty] - DIFF_RANK[b.difficulty] || b.habitat.score - a.habitat.score : b.habitat.score - a.habitat.score);
}
