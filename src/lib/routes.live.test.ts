// Live route search against USFS, OSM, land and CDFW services (`npm run test:live`).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { setHttp } from './http';
import { DEFAULT_FILTERS, fetchRouteData, filterRoutes, prepareRouteData, searchRoutes } from './trails';

beforeAll(() => setHttp(async (url, init) => {
    if (url.startsWith('/osm/')) { const txt = readFileSync(`public${url}`, 'utf8'); return { json: async () => JSON.parse(txt) }; }
  // Overpass rejects requests without a browser-like UA and an Origin header (browsers send both).
  const args = ['-sS', '-m', '120', '-A', 'Mozilla/5.0 (Macintosh) ca-fishing-map/1.0', '-H', 'Origin: http://localhost:5173', ...(init?.body ? ['--data', String(init.body)] : []), url];
  const out = execFileSync('curl', args, { maxBuffer: 2e8 }).toString();
  return { json: async () => JSON.parse(out) };
}));

// Mammoth Lakes Basin / Ansel Adams & John Muir Wilderness (Inyo NF)
const MAMMOTH = { south: 37.55, west: -119.10, north: 37.70, east: -118.90 };

describe('route search (live)', () => {
  // Each search can take 30-90 s when Overpass is busy (it retries with backoff).
  it('finds Mammoth-area trails with lakes, official mileage, and access checks', { timeout: 400_000 }, async () => {
    const t0 = Date.now();
    const data = prepareRouteData(await fetchRouteData(MAMMOTH));
    const r = filterRoutes(data, { ...DEFAULT_FILTERS, minMiles: 1, maxMiles: 40 });
    console.log(`searched ${r.considered} trails in ${Date.now() - t0} ms -> ${r.routes.length} routes; errors: ${r.errors.join(', ') || 'none'}`);
    for (const rt of r.routes.slice(0, 12))
      console.log(`  ${rt.name.padEnd(42)} ${rt.miles.toFixed(1).padStart(5)} mi  ${rt.source}  ${rt.manager.padEnd(12)} waters: ` +
        rt.waters.slice(0, 4).map(w => `${w.name} (${Math.round(w.meters)}m, ${w.status}, trout: ${w.trout.note} [${w.trout.source}])`).join('; '));
    expect(r.errors).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/static extract/); // no live Overpass query
    const sherwin = r.routes.find(rt => /sherwin lakes/i.test(rt.name));
    expect(sherwin?.source).toBe('USFS');
    expect(sherwin!.miles).toBeGreaterThan(2.5);
    expect(sherwin!.waters.some(w => /sherwin/i.test(w.name))).toBe(true);
    // CDFW's map numbers Twin Lakes (Mammoth) §7.50(b)(157) (Twelvemile Creek); the text entry is (158), 5 trout.
    const twin = r.routes.flatMap(rt => rt.waters).find(w => /^twin lakes$/i.test(w.name));
    expect(twin?.rules.map(s => s.code)).toContain('7.50(b)(158)');
    expect(twin?.trout.keep).toBe(true);
    // Every water gets a trout rule; keep-filter leaves only waters where trout may be kept.
    expect(r.routes.every(rt => rt.waters.every(w => w.trout.source))).toBe(true);
    const keep = filterRoutes(data, { ...DEFAULT_FILTERS, minMiles: 1, maxMiles: 40, trout: 'keep' }); // no re-download
    expect(keep.errors).toEqual([]);
    expect(keep.routes.length).toBeGreaterThan(0);
    expect(keep.routes.every(rt => rt.waters.every(w => w.trout.keep))).toBe(true);
    console.log(`trout possession allowed: ${keep.routes.length} routes (errors: ${keep.errors.join(', ') || 'none'}); catch-and-release-only waters seen: ` +
      [...new Set(r.routes.flatMap(rt => rt.waters.filter(w => w.trout.daily === 0).map(w => `${w.name} [${w.trout.source}]`)))].join(', '));
  });

  it('drops trails and waters outside California (Tahoe, Nevada side)', { timeout: 300_000 }, async () => {
    const r = await searchRoutes({ south: 38.95, west: -120.1, north: 39.1, east: -119.9 }, { ...DEFAULT_FILTERS, minMiles: 0, maxMiles: 50 });
    console.log(`tahoe: ${r.routes.length} routes; errors: ${r.errors.join(', ') || 'none'}`);
    expect(r.errors).toEqual([]);
    for (const rt of r.routes) for (const w of rt.waters) expect(w.at[0]).toBeLessThan(-119.93); // CA/NV line here is ~-119.95..-120.0
  });
});
