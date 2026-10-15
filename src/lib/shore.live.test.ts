// Live shore-spot search (`npm run test:live`): Coastal Commission, CDFW shoreline/MPAs, NOAA elevation, static OSM tiles.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { setHttp } from './http';
import { DEFAULT_SHORE_FILTERS, filterSpots, findShoreSpots, ROCK_LABEL, type RockKind } from './shore';

beforeAll(() => setHttp(async (url, init) => {
  if (url.startsWith('/osm/')) { const txt = readFileSync(`public${url}`, 'utf8'); return { json: async () => JSON.parse(txt) }; }
  if (/overpass/.test(url)) throw new Error('unexpected live Overpass call');
  const out = execFileSync('curl', ['-sS', '-m', '120', ...(init?.body ? ['--data', String(init.body)] : []), url], { maxBuffer: 2e8 }).toString();
  return { json: async () => JSON.parse(out) };
}));

describe('shore spots (live)', () => {
  it.each([
    ['Pacifica to Half Moon Bay', { south: 37.45, west: -122.56, north: 37.66, east: -122.43 }],
    ['Monterey Peninsula / Point Lobos', { south: 36.50, west: -121.99, north: 36.65, east: -121.88 }]
  ])('%s', async (_name, bbox) => {
    const t0 = performance.now();
    const r = await findShoreSpots(bbox);
    const all = filterSpots(r, { ...DEFAULT_SHORE_FILTERS, showNoTake: true });
    const shown = filterSpots(r, DEFAULT_SHORE_FILTERS);
    console.log(`${_name}: ${(performance.now() - t0).toFixed(0)} ms; ${r.spots.length} spots (${shown.length} shown by default; ${all.length - shown.length} in no-take MPAs); ` +
      `rock kinds: ${r.rock.map(k => `${k.kind}×${k.lines.length}`).join(', ')}; errors: ${r.errors.join(', ') || 'none'}`);
    for (const s of all.slice(0, 10)) {
      const hab = Object.entries(s.habitat.meters).map(([k, m]) => `${Math.round(m!)} m ${ROCK_LABEL[k as RockKind]}`).join(', ');
      console.log(`  [${s.difficulty.padEnd(8)}] ${s.name.slice(0, 34).padEnd(34)} ${s.source.padEnd(12)} bluff ${s.bluffM === null ? '?' : Math.round(s.bluffM) + ' m'}${s.sheer ? ' sheer' : ''}` +
        ` | ${hab} | ${s.mpa ? `${s.mpa.type} ${s.mpa.status}` : 'no MPA'} | ${s.groundfishArea}${s.closed ? ' | CLOSED ' + s.closed : ''}`);
    }
    expect(r.errors).toEqual([]);
    expect(r.spots.length).toBeGreaterThan(0);
    expect(r.spots.every(s => s.groundfishArea)).toBe(true);
  }, 300_000);
});
