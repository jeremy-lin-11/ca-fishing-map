// CDFW fish plantings: the hatchery planting log (BIOS ds2897), one row per water and planting week, from about a
// year back through the next announced week. The same data as CDFW's Fishing Guide map. Plain data, no Leaflet.
import { CONFIG } from '../config';
import { arcFeatures, type Attrs } from './arcgis';

export const RECENT_PLANT_DAYS = 42;

export interface Planting { week: string; fish: string } // week: ISO date the planting week starts
export interface PlantSite { id: number; water: string; county: string; lat: number; lng: number; last?: Planting; next?: Planting; count: number }
export type PlantStatus = 'upcoming' | 'recent' | 'older';

const weekStart = (iso: string) => new Date(`${iso}T12:00:00`);
const DAY = 864e5;

// Plantings this week or later are "next"; the latest before this week is "last".
export function lastAndNext(rows: Attrs[], today: Date): { last?: Planting; next?: Planting } {
  const all = rows.filter(r => r.WeekOfPlantStart).map(r => ({ week: String(r.WeekOfPlantStart), fish: String(r.FishType || 'Fish') }))
    .sort((a, b) => a.week.localeCompare(b.week));
  const thisWeek = (p: Planting) => weekStart(p.week).getTime() + 7 * DAY > today.getTime();
  return { last: all.filter(p => !thisWeek(p)).pop(), next: all.find(thisWeek) };
}

export function plantStatus(s: Pick<PlantSite, 'last' | 'next'>, today: Date): PlantStatus {
  if (s.next) return 'upcoming';
  return s.last && today.getTime() - weekStart(s.last.week).getTime() <= RECENT_PLANT_DAYS * DAY ? 'recent' : 'older';
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v)); // Number(null) is 0

// One site per stocked water.
export function plantSites(rows: Attrs[], today: Date): PlantSite[] {
  const byWater = new Map<number, Attrs[]>();
  for (const r of rows) {
    const id = num(r.StockingWaterID);
    if (Number.isFinite(id) && Number.isFinite(num(r.Lat)) && Number.isFinite(num(r.Lon))) byWater.set(id, [...(byWater.get(id) ?? []), r]);
  }
  return [...byWater].map(([id, rs]) => ({
    id, water: String(rs[0].WaterName || 'Stocked water'), county: String(rs[0].Counties || ''),
    lat: +rs[0].Lat, lng: +rs[0].Lon, count: rs.length, ...lastAndNext(rs, today)
  }));
}

const FIELDS = 'StockingWaterID,WaterName,Counties,Lat,Lon,WeekOfPlantStart,FishType';
let sitesPromise: Promise<PlantSite[]> | null = null;
// Every site, fetched once per session (about 2,000 rows).
export function fetchPlantSites(today = new Date()): Promise<PlantSite[]> {
  sitesPromise ??= arcFeatures(CONFIG.pressure.plantings, { where: '1=1', outFields: FIELDS, returnGeometry: 'false' })
    .then(fs => plantSites(fs.map(f => f.attributes), today))
    .catch(e => { sitesPromise = null; throw e; });
  return sitesPromise;
}

export const fmtWeek = (iso: string) => weekStart(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// "Packer Lake (Sierra): trout next planted the week of Oct 25; last the week of Oct 11"
export function plantSummary(s: Pick<PlantSite, 'water' | 'county' | 'last' | 'next'>): string {
  const fish = (p: Planting) => p.fish.toLowerCase();
  const parts = [s.next && `${fish(s.next)} planting scheduled the week of ${fmtWeek(s.next.week)}`,
    s.last && `last planted ${fish(s.last)} the week of ${fmtWeek(s.last.week)}`].filter(Boolean);
  return `${s.water}${s.county ? ` (${s.county})` : ''}: ${parts.join('; ') || 'no plantings in the past year'}`;
}
