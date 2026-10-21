// Hits the real services (run with `npm run test:live`). Uses curl so it works behind proxies
// where Node's fetch can't connect.
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { setHttp } from './http';
import { analyzePoint, fetchPoint, interpret, type Analysis } from './analyze';
import { fetchOffline, offlineRaw } from './offline';
import { regsFreshness } from './regdata';
import { CONFIG } from '../config';

beforeAll(() => setHttp(async (url, init) => {
  const args = ['-sS', '-m', '60', '-A', 'ca-fishing-map-test', ...(init?.body ? ['--data', String(init.body)] : []), url];
  const out = execFileSync('curl', args, { maxBuffer: 1e8 }).toString();
  return { json: async () => JSON.parse(out) };
}));

const at = (lat: number, lng: number) => analyzePoint({ lat, lng }, 12, 'auto');
const depthText = (a: Analysis) => a.depth.map(n => `${n.strong ?? ''}${n.text ?? ''}`).join(' | ');

describe('live services', () => {
  it('Crowley Lake: LADWP land / lake surface, special lake regs, two season periods', async () => {
    const a = await at(37.5934, -118.7364);
    expect(a.water).toBe('lake');
    expect(a.landBadge.status).toBe('ok'); // was "likely private" before the CAL FIRE ownership layer
    expect(a.trout?.source).toMatch(/7\.50\(b\)\(38\)/);
    const crowley = a.regs!.special.find(g => g.code === '7.50(b)(38)(B)')!;
    expect(crowley).toBeTruthy();
    expect(crowley.rows[0]).toMatchObject({ type: 'table' });
    expect((crowley.rows[0] as any).segments).toHaveLength(2);
    expect(a.regs!.special.some(g => g.code === '7.50(b)(104)')).toBe(true); // Owens River
  });
  it('Point Lobos: MPA restricted, ocean, depth + nearest RCA lines', async () => {
    const a = await at(36.5, -121.9945);
    expect(a.water).toBe('ocean');
    expect(a.verdict.text).toBe('Fishing restricted (MPA)');
    expect(a.notes[0].strong).toMatch(/Point Lobos/);
    expect(depthText(a)).toMatch(/≈ \d+ m/);
    expect(depthText(a)).toMatch(/100-fm.*75-fm|75-fm.*100-fm/);
  });
  it('Alabama Hills: BLM, legal', async () => {
    const a = await at(36.61, -118.13);
    expect(a.lands[0].key).toBe('BLM');
    expect(a.verdict.status).toBe('ok');
  });
  it('Monterey Bay offshore: ocean ≈ 803 m', async () => {
    const a = await at(36.75, -122.0);
    expect(a.water).toBe('ocean');
    expect(depthText(a)).toContain('≈ 803 m');
  });
  it('Half Moon Bay nearshore: next to the 30-fm RCA line', async () => {
    expect(depthText(await at(37.45, -122.55))).toMatch(/30-fm/);
  });
  it('Lake Tahoe: chart available', async () => {
    expect(depthText(await at(39.09, -120.04))).toMatch(/Lake Tahoe bathymetric chart available/);
  });
  it('Salton Sea: estimated depth from survey contours', async () => {
    const a = await at(33.3, -115.85);
    expect(a.water).toBe('lake');
    expect(depthText(a)).toMatch(/roughly \d+ ft deep/);
  });
  it('Shasta Lake: Forest Service, no survey', async () => {
    const a = await at(40.78, -122.35);
    expect(a.lands[0].key).toBe('USFS');
    expect(depthText(a)).toMatch(/No published depth survey/);
  });
  it('Central Valley farmland: likely private', async () => {
    const a = await at(36.75, -119.95);
    expect(a.landBadge.text).toBe('Not mapped / likely private');
    expect(a.errors).toEqual([]);
  });
  it('Owens River below Crowley: LADWP land is public', async () => {
    const a = await at(37.25, -118.35);
    expect(a.lands[0]?.key).toBe('LADWP');
    expect(a.landBadge.text).toBe('Public');
  });
  it('South Bay salt pond: bay water (not a lake), refuge rules, no trout limit', async () => {
    const a = await at(37.43357, -122.04248);
    expect(a.water).toBe('ocean');
    expect(a.trout).toBeNull();
    expect(a.notes.map(n => n.strong)).toEqual(expect.arrayContaining(['San Francisco Bay District', 'Salt evaporation pond']));
  });
  it('open San Francisco Bay: ocean rules, though inland district polygons cover it', async () => {
    for (const [lat, lng] of [[37.52, -122.13], [38.05, -122.35]]) expect((await at(lat, lng)).water).toBe('ocean');
    expect((await at(38.07, -122.05)).water).toBe('stream'); // Suisun Bay, east of the Carquinez Bridge: inland waters
  });
  it('coastal bays and harbors: ocean rules; river-mouth estuaries stay inland', async () => {
    for (const [lat, lng] of [[32.705, -117.228], [40.765, -124.205], [38.2, -122.94], [32.775, -117.225]]) // San Diego, Humboldt, Tomales, Mission
      expect((await at(lat, lng)).water).toBe('ocean');
    expect((await at(39.426, -123.80)).water).toBe('stream'); // Noyo River estuary: inland tidewater (§1.53)
  });
  it('offline area around Crowley Lake answers like the online check', async () => {
    const o = await fetchOffline({ south: 37.55, west: -118.80, north: 37.66, east: -118.66 });
    expect(o.land.length).toBeGreaterThan(0);
    expect(o.lakes.length).toBeGreaterThan(0);
    for (const [lat, lng] of [[37.5934, -118.7364], [37.6445, -118.7230]]) { // lake surface; Owens River below the dam
      const p = { lat, lng }, day = new Date(2026, 6, 4);
      const online = interpret(p, 'auto', await fetchPoint(p, 12), day);
      const offline = interpret(p, 'auto', offlineRaw(structuredClone(o), p, 12), day);
      expect(offline.water).toBe(online.water);
      expect(offline.landBadge.status).toBe(online.landBadge.status);
      expect(offline.trout).toEqual(online.trout);
      expect(offline.regs?.special.map(g => g.code).sort()).toEqual(online.regs?.special.map(g => g.code).sort());
    }
  }, 180_000);
  it('regulation freshness: dataset date and cited booklet', async () => {
    const f = await regsFreshness(CONFIG.regs, new Date(2026, 9, 14));
    console.log('freshness', JSON.stringify(f));
    expect(f.updated).not.toBeNull();
    expect(f.cites.length).toBeGreaterThan(0);
    expect(f.current).toBe('2026–2027');
  });
});
