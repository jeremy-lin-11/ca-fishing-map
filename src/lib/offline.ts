// Offline areas: everything needed to answer fishing checks inside a saved area with no network.
//
// Saved per area: land ownership polygons with their Own_* fields, CDFW regulation polygons (lakes, streams,
// tributary areas, all districts) with their text rows, and Esri water-body polygons (for "is this click on a
// lake"). An offline fishing check rebuilds the same Raw input the online check gets from the services, then runs
// the same interpret(), so offline answers can't drift from online ones.
import { CONFIG } from '../config';
import { arcFeatures, type Attrs } from './arcgis';
import type { Raw } from './analyze';
import { californiaQueryParams } from './california';
import { bboxSpanKm, nearestBetween, pointInPolygon, projector, type BBox, type Coord, type Line } from './geo';
import { fetchRegRows, KINDS, resolveHits, type Hit } from './regdata';
import type { LatLng } from '../types';

// 'area' = tributary/drainage polygons ("X Lake and tributaries"), which apply to any water inside them.
// 'district' = district and county polygons (§7.00 general regulations and others).
export interface RegFeature { kind: 'lake' | 'stream' | 'area' | 'district'; code: string; desc: string; lines: Line[]; mapCode?: string; unverified?: boolean }
export const KIND_IDX = { lake: 0, stream: 1, area: 2, district: 3 } as const;
export interface LandPoly { rings: Line[]; attrs: Attrs } // attrs: Own_* fields
export interface WaterPoly { rings: Line[]; attrs: Attrs } // attrs: NAME, FTYPE

export interface OfflineData {
  bbox: BBox;
  land: LandPoly[];
  regFeatures: RegFeature[];
  regRows: Attrs[];
  // Areas saved before the route search was removed have OSM lakes ({ name, lines }) here instead.
  lakes: (WaterPoly | { name: string; lines: Line[] })[];
}

export interface SavedArea {
  id: string;
  name: string;
  bbox: BBox;
  savedAt: string;   // ISO
  offline: OfflineData;
  tiles: string[];   // cached basemap tile URLs
  tileBytes: number;
}

export function checkSaveArea(b: BBox): string | null {
  const { ns, ew } = bboxSpanKm(b), max = CONFIG.offline.maxKm;
  return ns > max || ew > max ? `Zoom in: the area is ${Math.round(Math.max(ns, ew))} km across (max ${max} km).` : null;
}

// Spatial filter for the area, clipped to California.
const envelopeFor = (b: BBox) => californiaQueryParams(b) ?? {
  geometry: `${b.west},${b.south},${b.east},${b.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects'
};
// ArcGIS JSON polylines/polygons -> arrays of [lng, lat] lines.
const paths = (g: any): Line[] => (g?.paths || g?.rings || []) as Line[];

async function fetchRegs(b: BBox): Promise<{ features: RegFeature[]; rows: Attrs[] }> {
  const R = CONFIG.regs;
  const opts = { ...envelopeFor(b), where: 'reg_number IS NOT NULL', outFields: 'feat_desc,reg_number', geometryPrecision: '5' };
  const [lakes, streams, areas, districts] = await Promise.all([
    arcFeatures(`${R.url}/${R.layers.lakes}`, opts), arcFeatures(`${R.url}/${R.layers.streams}`, opts),
    arcFeatures(`${R.url}/${R.layers.tributary}`, { ...opts, maxAllowableOffset: '0.0005' }),
    arcFeatures(`${R.url}/${R.layers.districts}`, { ...opts, maxAllowableOffset: '0.002' })
  ]);
  const mapped: RegFeature[] = [
    ...lakes.map(f => ({ kind: 'lake' as const, f })), ...streams.map(f => ({ kind: 'stream' as const, f })),
    ...areas.map(f => ({ kind: 'area' as const, f })), ...districts.map(f => ({ kind: 'district' as const, f }))
  ].map(({ kind, f }) => ({ kind, code: String(f.attributes.reg_number).trim(), desc: String(f.attributes.feat_desc || '').replace(/\[[a-z]\]/g, '').trim(), lines: paths(f.geometry) }));
  if (!mapped.length) return { features: [], rows: [] };
  const features = await resolveHits(R, mapped);
  return { features, rows: [...(await fetchRegRows(R, features.map(f => f.code))).values()] };
}

// Downloads the data for an offline area (land, regulations, lakes). Any failure fails the save: a partial
// area would give wrong answers offline.
export async function fetchOffline(b: BBox): Promise<OfflineData> {
  const L = CONFIG.layers;
  const [land, regs, lakes] = await Promise.all([
    arcFeatures(L.ownership.url, { ...envelopeFor(b), where: '1=1', maxAllowableOffset: '0.0002', geometryPrecision: '5',
      outFields: 'Own_Level,Own_Group,Own_Agency' }, 10),
    fetchRegs(b),
    arcFeatures(L.waterBodies.url, { ...envelopeFor(b), where: "FTYPE LIKE '%Lake%' OR FTYPE LIKE '%Reservoir%'", maxAllowableOffset: '0.0001',
      geometryPrecision: '5', outFields: 'NAME,FTYPE' }, 10)
  ]);
  return {
    bbox: b, regFeatures: regs.features, regRows: regs.rows,
    land: land.map(f => ({ rings: paths(f.geometry), attrs: f.attributes })),
    lakes: lakes.map(f => ({ rings: paths(f.geometry), attrs: f.attributes }))
  };
}

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
  const lake = o.lakes.find(w => pointInPolygon(at, 'rings' in w ? w.rings : w.lines));
  return {
    own: o.land.filter(p => pointInPolygon(at, p.rings)).map(p => p.attrs),
    waterBody: !lake ? [] : 'attrs' in lake ? [lake.attrs] : [{ NAME: lake.name, FTYPE: 'Lake/Pond' }],
    fed: [], parks: [], mpa: [],
    geo: { address: { state: 'California' } }, // the area is inside California; there's no geocoder offline
    dem: null, rca: [], contours: [],
    regs: { hits, rowsByCode: new Map(o.regRows.map(r => [String(r.code), r])), failed: [] }
  };
}
