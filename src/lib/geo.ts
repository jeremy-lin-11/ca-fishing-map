// Small planar geometry helpers. Search areas are < ~60 km across, so an equirectangular
// projection around the area's center is accurate to well under 1% for distances.
import type { LatLng } from '../types';

export type Coord = [number, number]; // [lng, lat], GeoJSON order
export type Line = Coord[];
export interface BBox { south: number; west: number; north: number; east: number }

const R = 6371008.8; // mean Earth radius, m
export const M_PER_MILE = 1609.344;

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

export const lineLength = (line: Line) => line.reduce((t, c, i) => (i ? t + haversine(line[i - 1], c) : 0), 0);

// Distance from point p to segment ab, all in projected meters.
function pointSegDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export interface Nearest { meters: number; at: Coord } // `at` = closest vertex on the target geometry

// Closest approach between trail lines and target (water) lines, within maxMeters.
// Checks water vertices against trail segments and trail vertices against water segments, so
// sparse vertex spacing on either side can't hide a near pass. `at` is the nearest water vertex.
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

export const toLatLng = ([lng, lat]: Coord): LatLng => ({ lat, lng });
export const bboxSpanKm = (b: BBox) => ({
  ns: haversine([b.west, b.south], [b.west, b.north]) / 1000,
  ew: haversine([b.west, (b.south + b.north) / 2], [b.east, (b.south + b.north) / 2]) / 1000
});

// Douglas-Peucker on projected points; returns indices of the kept (original) vertices.
function simplifyIdx(pts: [number, number][], tol: number): number[] {
  if (pts.length < 3) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1, wi = -1;
    for (let k = i + 1; k < j; k++) { const d = pointSegDist(pts[k], pts[i], pts[j]); if (d > worst) { worst = d; wi = k; } }
    if (worst > tol) { keep[wi] = 1; stack.push([i, wi], [wi, j]); }
  }
  const out: number[] = []; keep.forEach((v, i) => { if (v) out.push(i); }); return out;
}

// All (a, b) pairs of line sets that come within maxMeters of each other, with the closest approach.
// Lines are first simplified (Douglas-Peucker, `tolMeters`, keeping original vertices), then a uniform grid
// (cell = maxMeters) over each side's segments limits each vertex to segments in its 3x3 neighbourhood.
// Distances are exact to the simplified lines, i.e. within tolMeters of exact. `at` is the nearest b vertex.
export function nearPairs(A: Line[][], B: Line[][], proj: (c: Coord) => [number, number], maxMeters: number, tolMeters = 10): Map<number, Map<number, Nearest>> {
  const G = maxMeters;
  type Pl = { pts: [number, number][]; orig: Coord[] }; // simplified projected points + matching original coords
  const prep = (S: Line[][]): Pl[][] => S.map(ls => ls.map(l => {
    const P = l.map(proj), idx = simplifyIdx(P, tolMeters);
    return { pts: idx.map(i => P[i]), orig: idx.map(i => l[i]) };
  }));
  const PA = prep(A), PB = prep(B);
  const out = new Map<number, Map<number, Nearest>>();
  const offer = (a: number, b: number, d: number, at: Coord) => {
    if (d > maxMeters) return;
    let m = out.get(a); if (!m) out.set(a, (m = new Map()));
    const cur = m.get(b); if (!cur || d < cur.meters) m.set(b, { meters: d, at });
  };
  type Seg = { owner: number; line: Pl; i: number }; // segment line.pts[i-1] -> line.pts[i]
  const key = (x: number, y: number) => x * 1_000_003 + y;
  const grid = (P: Pl[][]) => {
    const g = new Map<number, Seg[]>();
    P.forEach((ls, owner) => ls.forEach(line => {
      for (let i = 1; i < line.pts.length; i++) {
        const p = line.pts[i - 1], q = line.pts[i], seg: Seg = { owner, line, i };
        for (let x = Math.floor(Math.min(p[0], q[0]) / G); x <= Math.floor(Math.max(p[0], q[0]) / G); x++)
          for (let y = Math.floor(Math.min(p[1], q[1]) / G); y <= Math.floor(Math.max(p[1], q[1]) / G); y++) {
            const k = key(x, y), arr = g.get(k); if (arr) arr.push(seg); else g.set(k, [seg]);
          }
      }
    }));
    return g;
  };
  const eachNear = (g: Map<number, Seg[]>, [px, py]: [number, number], fn: (s: Seg) => void) => {
    const cx = Math.floor(px / G), cy = Math.floor(py / G);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) { const arr = g.get(key(x, y)); if (arr) for (const s of arr) fn(s); }
  };
  // b vertices -> a segments (at = that b vertex)
  const gA = grid(PA);
  PB.forEach((ls, b) => ls.forEach(line => line.pts.forEach((p, pi) =>
    eachNear(gA, p, s => offer(s.owner, b, pointSegDist(p, s.line.pts[s.i - 1], s.line.pts[s.i]), line.orig[pi])))));
  // a vertices -> b segments (at = the closer endpoint of that b segment)
  const gB = grid(PB);
  PA.forEach((ls, a) => ls.forEach(line => line.pts.forEach(p => eachNear(gB, p, s => {
    const p0 = s.line.pts[s.i - 1], p1 = s.line.pts[s.i];
    const closer = Math.hypot(p[0] - p0[0], p[1] - p0[1]) <= Math.hypot(p[0] - p1[0], p[1] - p1[1]) ? s.i - 1 : s.i;
    offer(a, s.owner, pointSegDist(p, p0, p1), s.line.orig[closer]);
  }))));
  return out;
}
