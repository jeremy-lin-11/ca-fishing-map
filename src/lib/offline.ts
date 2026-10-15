// Offline areas: everything needed to search routes and answer fishing checks inside a saved area with no network.
//
// Saved per area: the prepared route search (filters still work), land ownership polygons with their Own_* fields,
// CDFW regulation polygons (lakes, streams, tributary areas, all districts) with their text rows, and OSM lake
// polygons (for "is this click on a lake"). An offline fishing check rebuilds the same Raw input the online check
// gets from the services, then runs the same interpret(), so offline answers can't drift from online ones.
import type { Attrs } from './arcgis';
import type { Raw } from './analyze';
import { nearestBetween, pointInPolygon, projector, type BBox, type Coord } from './geo';
import { KINDS, type Hit } from './regdata';
import { KIND_IDX, type LandPoly, type Prepared, type RawWater, type RegFeature, type RouteData } from './trails';
import type { LatLng } from '../types';

export interface OfflineData {
  bbox: BBox;
  land: LandPoly[];
  regFeatures: RegFeature[];
  regRows: Attrs[];
  lakes: RawWater[];
}

export interface SavedArea {
  id: string;
  name: string;
  bbox: BBox;
  savedAt: string;   // ISO
  prepared: Prepared;
  offline: OfflineData;
  tiles: string[];   // cached basemap tile URLs
  tileBytes: number;
}

export const toOffline = (d: RouteData): OfflineData =>
  ({ bbox: d.bbox, land: d.land, regFeatures: d.regs.features, regRows: d.regs.rows, lakes: d.waters.filter(w => w.kind === 'lake') });

export const inBox = (p: LatLng, b: BBox) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
export const areaFor = (areas: SavedArea[], p: LatLng) => areas.find(a => inBox(p, a.bbox)) ?? null;

// The Raw a fishing check would get from the services, built from saved data. Depth, place names, MPAs (inland
// areas) and unit names aren't saved; the check reports land owners by CAL FIRE agency name instead.
export function offlineRaw(o: OfflineData, point: LatLng, zoom: number): Raw {
  const at: Coord = [point.lng, point.lat];
  const proj = projector(point.lat);
  const tol = 14 * 156543 * Math.cos(point.lat * Math.PI / 180) / Math.pow(2, zoom); // same click radius as online
  const hits: Hit[] = [];
  for (const f of o.regFeatures) {
    const applies = f.kind === 'stream' ? nearestBetween([[at]], f.lines, proj, tol) !== null : pointInPolygon(at, f.lines);
    if (applies) hits.push({ kind: KINDS[KIND_IDX[f.kind]], desc: f.desc, code: f.code, mapCode: f.mapCode, unverified: f.unverified });
  }
  const lake = o.lakes.find(w => pointInPolygon(at, w.lines));
  return {
    own: o.land.filter(p => pointInPolygon(at, p.rings)).map(p => p.attrs),
    waterBody: lake ? [{ NAME: lake.name, FTYPE: 'Lake/Pond' }] : [],
    fed: [], parks: [], mpa: [],
    geo: { address: { state: 'California' } }, // the area is inside California; there's no geocoder offline
    dem: null, rca: [], contours: [],
    regs: { hits, rowsByCode: new Map(o.regRows.map(r => [String(r.code), r])), failed: [] }
  };
}
