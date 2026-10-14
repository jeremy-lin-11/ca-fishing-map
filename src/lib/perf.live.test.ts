import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { setHttp } from './http';
import { DEFAULT_FILTERS, fetchRouteData, filterRoutes, prepareRouteData } from './trails';

// Regression guard for the route-search freeze: filtering used to take ~20 s per change on this view
// and ran on every keystroke. Preparation runs once per search; filtering must stay instant.
it('route search stays fast on a large real view', async () => {
  setHttp(async (url, init) => {
    if (url.startsWith('/osm/')) { const txt = readFileSync(`public${url}`, 'utf8'); return { json: async () => JSON.parse(txt) }; }
    const out = execFileSync('curl', ['-sS', '-m', '120', '-A', 'Mozilla/5.0 (Macintosh) ca-fishing-map/1.0', '-H', 'Origin: http://localhost:5173', ...(init?.body ? ['--data', String(init.body)] : []), url], { maxBuffer: 2e8 }).toString();
    return { json: async () => JSON.parse(out) };
  });
  // Mammoth basin, and a larger 55 km view (near the max search size) around it
  for (const [name, b] of [
                           ['Mammoth 55 km', { south: 37.40, west: -119.30, north: 37.85, east: -118.75 }]] as const) {
    const t0 = performance.now();
    const d = await fetchRouteData(b);
    const t1 = performance.now();
    const verts = (ls: number[][][]) => ls.reduce((t, l) => t + l.length, 0);
    expect(d.errors).toEqual([]);
    console.log(`${name}: fetch ${(t1 - t0).toFixed(0)} ms, errors: ${d.errors.join(', ') || 'none'}; trails ${d.trails.length} (${d.trails.reduce((t, x) => t + verts(x.lines), 0)} verts), ` +
      `waters ${d.waters.length} (${d.waters.reduce((t, x) => t + verts(x.lines), 0)} verts), land polys ${d.land.length} (${d.land.reduce((t, x) => t + verts(x.rings), 0)} verts), reg features ${d.regs.features.length}`);
    const sp = performance.now();
    const p = prepareRouteData(d);
    const prepMs = performance.now() - sp;
    console.log(`   prepare (once per search): ${prepMs.toFixed(0)} ms`);
    expect(prepMs).toBeLessThan(3000);
    for (const f of [DEFAULT_FILTERS, { ...DEFAULT_FILTERS, minMiles: 1 }, { ...DEFAULT_FILTERS, trout: 'keep' as const }]) {
      const s = performance.now();
      const r = filterRoutes(p, f);
      const ms = performance.now() - s;
      console.log(`   filter (min ${f.minMiles} mi, trout ${f.trout}): ${ms.toFixed(0)} ms -> ${r.routes.length} routes`);
      expect(ms).toBeLessThan(50);
    }
  }
}, 600_000);
