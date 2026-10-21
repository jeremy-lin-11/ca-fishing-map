// Estimated fishing pressure at a point. Nothing records how many people fish where, so this scores proxies:
// road access, people living nearby, CDFW trout stocking, developed sites, wilderness and catch-and-release rules.
// Every signal that moved the score is returned as a reason, so the estimate can be judged, not just trusted.
import { CONFIG } from '../config';
import { arcQuery, queryPoint, type Attrs } from './arcgis';
import { haversine } from './geo';
import { http } from './http';
import { loadPlaces } from './places';
import type { LatLng } from '../types';

export const ROAD_M = [400, 1600, 4800] as const; // ¼ mile, 1 mile, 3 miles
const PEOPLE_M = 48280;                             // 30 miles
const RECENT_PLANT_DAYS = 42;

// Raw signals, each null if its service failed.
export interface PressureRaw {
  roads: number[] | null;          // roads within each ROAD_M radius
  people: number | null;           // town population within PEOPLE_M
  stocked: Attrs[] | null;         // CDFW stocked waters at the point (StockingWaterID, last_yr_stkd)
  plantings: Attrs[] | null;       // latest planting for those waters (WeekOfPlantStart, FishType)
  wilderness: Attrs[] | null;
  coastalAccess: Attrs[] | null;   // within 400 m
  sites: Attrs[] | null;           // Forest Service developed sites within 800 m
}

export type PressureLevel = 'low' | 'moderate' | 'high';
export interface Pressure {
  level: PressureLevel;
  score: number;
  reasons: { text: string; effect: 1 | -1 }[]; // effect: draws more (1) or fewer (-1) anglers
  missing: string[];                           // signals that couldn't be loaded
}

const settle = <T,>(p: Promise<T>) => p.catch(() => null);

async function roadCounts(p: LatLng): Promise<number[]> {
  return Promise.all(ROAD_M.map(async m => {
    const body = new URLSearchParams({ f: 'json', where: '1=1', returnCountOnly: 'true', geometry: `${p.lng},${p.lat}`,
      geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: String(m), units: 'esriSRUnit_Meter' });
    const j = await (await http(`${CONFIG.pressure.roads}/query`, { method: 'POST', body })).json();
    if (j.error || typeof j.count !== 'number') throw new Error(j.error?.message || 'roads query failed');
    return j.count as number;
  }));
}

async function peopleNear(p: LatLng): Promise<number> {
  const places = await loadPlaces();
  let total = 0;
  for (const t of places) if (t.kind === 'town' && t.pop && haversine([p.lng, p.lat], [t.lng, t.lat]) <= PEOPLE_M) total += t.pop;
  return total;
}

// tol: the click radius (m), so a click on a mapped stream line counts as on the water.
export async function fetchPressure(p: LatLng, tol: number): Promise<PressureRaw> {
  const P = CONFIG.pressure;
  const stockedP = settle(queryPoint(P.stocked, p, { meters: Math.max(tol, 100), outFields: 'StockingWaterID,last_yr_stkd' }));
  const plantingsP = stockedP.then(st => {
    const ids = [...new Set((st ?? []).map(s => Number(s.StockingWaterID)).filter(Number.isFinite))];
    if (!st) return null;
    if (!ids.length) return [];
    return settle(arcQuery(P.plantings, { where: `StockingWaterID IN (${ids.join(',')})`, outFields: 'WaterName,WeekOfPlantStart,FishType',
      orderByFields: 'WeekOfPlantStart DESC', resultRecordCount: '1' }));
  });
  const [roads, people, stocked, plantings, wilderness, coastalAccess, sites] = await Promise.all([
    settle(roadCounts(p)), settle(peopleNear(p)), stockedP, plantingsP,
    settle(queryPoint(P.wilderness, p, { outFields: 'NAME' })),
    settle(queryPoint(P.coastalAccess, p, { meters: 400, outFields: 'Name' })),
    settle(queryPoint(P.usfsSites, p, { where: P.usfsSitesWhere, meters: 800, outFields: 'recareaname,markeractivitygroup' }))
  ]);
  return { roads, people, stocked, plantings, wilderness, coastalAccess, sites };
}

const fmtPeople = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n >= 1e4 ? `${Math.round(n / 1e3)},000` : n.toLocaleString('en-US'));
const fmtWeek = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function estimatePressure(r: PressureRaw, o: { catchAndRelease: boolean; today: Date }): Pressure {
  const reasons: Pressure['reasons'] = [], missing: string[] = [];
  let score = 0;
  const add = (points: number, text: string) => { score += points; reasons.push({ text, effect: points > 0 ? 1 : -1 }); };

  if (!r.roads) missing.push('roads');
  else if (r.roads[0] > 0) add(3, 'Road within ¼ mile');
  else if (r.roads[1] > 0) add(2, 'Nearest road ¼–1 mile away');
  else if (r.roads[2] > 0) add(1, 'Nearest road 1–3 miles away');
  else add(-1, 'No road within 3 miles');

  if (r.people === null) missing.push('nearby population');
  else if (r.people >= 1e6) add(3, `About ${fmtPeople(r.people)} people live within 30 miles`);
  else if (r.people >= 25e4) add(2, `About ${fmtPeople(r.people)} people live within 30 miles`);
  else if (r.people >= 5e4) add(1, `About ${fmtPeople(r.people)} people live within 30 miles`);

  if (!r.stocked) missing.push('CDFW stocking');
  else if (r.stocked.length) {
    const last = r.plantings?.[0];
    const days = last ? (o.today.getTime() - new Date(`${last.WeekOfPlantStart}T12:00:00`).getTime()) / 864e5 : Infinity;
    const year = Math.max(...r.stocked.map(s => Number(s.last_yr_stkd) || 0));
    if (days >= -7 && days <= RECENT_PLANT_DAYS) add(2, `CDFW planted ${String(last!.FishType || 'fish').toLowerCase()} here the week of ${fmtWeek(last!.WeekOfPlantStart)}`);
    else if (last && days <= 365) add(1, `Stocked by CDFW (last planted the week of ${fmtWeek(last.WeekOfPlantStart)})`);
    else if (year >= o.today.getFullYear() - 1) add(1, `Stocked by CDFW (last in ${year})`);
  }

  if (!r.wilderness) missing.push('wilderness');
  else if (r.wilderness.length) add(-2, `Inside the ${String(r.wilderness[0].NAME).replace(/ Wilderness$/, '')} Wilderness: foot or horse access only`);

  const access = r.coastalAccess?.[0], site = r.sites?.[0];
  if (access) add(1, `Public coastal access nearby (${access.Name})`);
  else if (site) add(1, `Near ${site.recareaname}`);
  if (!r.coastalAccess || !r.sites) missing.push('developed sites');

  if (o.catchAndRelease) add(-1, 'Catch-and-release only, which deters many anglers');
  const day = o.today.getDay();
  if (day === 0 || day === 6) add(1, 'Weekend');

  return { level: score >= 5 ? 'high' : score >= 2 ? 'moderate' : 'low', score, reasons, missing };
}
