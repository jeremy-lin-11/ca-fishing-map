import polygonClipping, { type MultiPolygon } from 'polygon-clipping';
import { CA_VISIBLE } from '../data/california';
import { pointInPolygon, type Coord } from './geo';
import type { LatLng } from '../types';

// True if a point is in California or the ocean off its coast (the area the app covers).
export const inCalifornia = (p: LatLng | Coord) =>
  pointInPolygon(Array.isArray(p) ? p : [p.lng, p.lat], [CA_VISIBLE]);

// [[south, west], [north, east]] of the visible area.
export const CA_VISIBLE_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...CA_VISIBLE.map(c => c[1])), Math.min(...CA_VISIBLE.map(c => c[0]))],
  [Math.max(...CA_VISIBLE.map(c => c[1])), Math.max(...CA_VISIBLE.map(c => c[0]))]
];

// True if a lat/lng box overlaps the California area: a box corner is inside it, or one of its vertices
// is inside the box. That covers every way a box and this polygon can overlap except an edge slicing
// through a box with no corner or vertex involved, which can't happen for a box cut by one straight edge.
export function boxTouchesCalifornia(b: { south: number; west: number; north: number; east: number }): boolean {
  const [[s, w], [n, e]] = CA_VISIBLE_BOUNDS;
  if (b.north < s || b.south > n || b.east < w || b.west > e) return false;
  const corners: Coord[] = [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]];
  if (corners.some(c => inCalifornia(c))) return true;
  return CA_VISIBLE.some(([x, y]) => x >= b.west && x <= b.east && y >= b.south && y <= b.north);
}

// Intersection of a box with the California area's bounding box (null if they don't overlap).
export function clipToCalifornia<B extends { south: number; west: number; north: number; east: number }>(b: B): B | null {
  const [[s, w], [n, e]] = CA_VISIBLE_BOUNDS;
  const c = { ...b, south: Math.max(b.south, s), west: Math.max(b.west, w), north: Math.min(b.north, n), east: Math.min(b.east, e) };
  return c.south < c.north && c.west < c.east && boxTouchesCalifornia(c) ? c : null;
}

type Box = { south: number; west: number; north: number; east: number };

// What to send as a query's spatial filter for a box: the box itself when it's entirely inside the
// California area, the box clipped to California on the border (so the server never returns features
// that are wholly in Nevada, Oregon, Mexico...), or null when it doesn't touch California at all.
export function californiaQueryArea(b: Box): { type: 'box' } | { type: 'clipped'; polygon: MultiPolygon } | null {
  if (!boxTouchesCalifornia(b)) return null;
  const corners: Coord[] = [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]];
  const noVertexInside = !CA_VISIBLE.some(([x, y]) => x > b.west && x < b.east && y > b.south && y < b.north);
  if (noVertexInside && corners.every(c => inCalifornia(c))) return { type: 'box' };
  const clipped = polygonClipping.intersection([[...corners, corners[0]]], [CA_VISIBLE]);
  return clipped.length ? { type: 'clipped', polygon: clipped } : null;
}

// ArcGIS REST spatial-filter params (WGS84) for a box, restricted to California. null = nothing to query.
export function californiaQueryParams(b: Box): Record<string, string> | null {
  const area = californiaQueryArea(b);
  if (!area) return null;
  const spatial = { inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
  if (area.type === 'box') return { ...spatial, geometryType: 'esriGeometryEnvelope', geometry: `${b.west},${b.south},${b.east},${b.north}` };
  // polygon-clipping returns GeoJSON winding (outer rings counter-clockwise); ArcGIS wants outer rings clockwise.
  const rings = area.polygon.flat().map(r => [...r].reverse());
  return { ...spatial, geometryType: 'esriGeometryPolygon', geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }) };
}
