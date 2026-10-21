// Small planar geometry helpers. Distances are short (a click radius), so an equirectangular
// projection around the point is accurate to well under 1%.

export type Coord = [number, number]; // [lng, lat], GeoJSON order
export type Line = Coord[];
export interface BBox { south: number; west: number; north: number; east: number }

const R = 6371008.8; // mean Earth radius, m

export function projector(lat0: number) {
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
  const ky = (Math.PI / 180) * R;
  return ([lng, lat]: Coord): [number, number] => [lng * kx, lat * ky];
}

export function haversine(a: Coord, b: Coord): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad, dLng = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Distance from point p to segment ab, all in projected meters.
function pointSegDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export interface Nearest { meters: number; at: Coord } // `at` = closest vertex on the target geometry

// Closest approach between two sets of lines (e.g. a clicked point and a stream), within maxMeters.
// Checks each side's vertices against the other's segments, so sparse vertex spacing can't hide a
// near pass. `at` is the nearest target vertex.
export function nearestBetween(trail: Line[], target: Line[], proj: (c: Coord) => [number, number], maxMeters: number): Nearest | null {
  const T = trail.map(l => l.map(proj)), W = target.map(l => l.map(proj));
  const box = (ls: [number, number][][]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of ls) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1 };
  };
  const bt = box(T), bw = box(W);
  if (bw.x0 > bt.x1 + maxMeters || bw.x1 < bt.x0 - maxMeters || bw.y0 > bt.y1 + maxMeters || bw.y1 < bt.y0 - maxMeters) return null;

  let best: Nearest | null = null;
  const offer = (d: number, at: Coord) => { if (d <= maxMeters && (!best || d < best.meters)) best = { meters: d, at }; };
  W.forEach((wl, li) => wl.forEach((p, pi) => {
    for (const tl of T) for (let i = 1; i < tl.length; i++) offer(pointSegDist(p, tl[i - 1], tl[i]), target[li][pi]);
  }));
  for (const tl of T) for (const p of tl) W.forEach((wl, li) => {
    for (let i = 1; i < wl.length; i++) {
      const a = wl[i - 1], b = wl[i];
      const closer = Math.hypot(p[0] - a[0], p[1] - a[1]) <= Math.hypot(p[0] - b[0], p[1] - b[1]) ? i - 1 : i;
      offer(pointSegDist(p, a, b), target[li][closer]);
    }
  });
  return best;
}

// Ray casting; rings are closed or open, outer and holes alike (even-odd rule).
export function pointInPolygon([x, y]: Coord, rings: Line[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export const bboxSpanKm = (b: BBox) => ({
  ns: haversine([b.west, b.south], [b.west, b.north]) / 1000,
  ew: haversine([b.west, (b.south + b.north) / 2], [b.east, (b.south + b.north) / 2]) / 1000
});
