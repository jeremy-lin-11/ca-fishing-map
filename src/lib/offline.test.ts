import { describe, expect, it } from 'vitest';
import { tileUrls } from './tiles';
import { offlineRaw, type OfflineData } from './offline';
import { interpret } from './analyze';

describe('offline areas', () => {
  it('lists basemap tiles and lowers max zoom to stay under the cap', () => {
    const mammoth = { south: 37.55, west: -119.10, north: 37.70, east: -118.90 };
    const full = tileUrls(mammoth, 8, 14, 100000);
    expect(full.zMax).toBe(14);
    expect(full.urls[0]).toMatch(/^https:\/\/basemap\.nationalmap\.gov\/.+\/tile\/8\/\d+\/\d+$/);
    const capped = tileUrls({ south: 37.4, west: -119.3, north: 37.85, east: -118.75 }, 8, 15, 1000);
    expect(capped.urls.length).toBeLessThanOrEqual(1000);
    expect(capped.zMax).toBeLessThan(15);
  });
  it('answers a fishing check from saved data with the same interpret() as online', () => {
    const lakeRing = [[-119.0, 37.6], [-118.99, 37.6], [-118.99, 37.61], [-119.0, 37.61], [-119.0, 37.6]] as [number, number][];
    const o: OfflineData = {
      bbox: { south: 37.5, west: -119.1, north: 37.7, east: -118.9 },
      land: [{ rings: [[[-119.1, 37.5], [-118.9, 37.5], [-118.9, 37.7], [-119.1, 37.7]]],
        attrs: { Own_Level: 'Federal', Own_Group: 'US Forest Service', Own_Agency: 'United States Forest Service' } }],
      regFeatures: [{ kind: 'lake', code: '7.50(b)(158)', desc: 'Twin Lakes (Mammoth)', lines: [lakeRing] }],
      regRows: [{ code: '7.50(b)', verbatim: 'LIST[table header] Body of Water | Open Season and Special Restrictions | Daily Bag and Possession Limit' },
        { code: '7.50(b)(158)', verbatim: '[table row] Twin Lakes (Mammoth, Mono Co.). | Last Sat. in Apr. through Nov. 15. | 5 trout' }],
      lakes: [{ rings: [lakeRing], attrs: { NAME: 'Twin Lakes', FTYPE: 'Lake/Pond' } }]
    };
    const p = { lat: 37.605, lng: -118.995 };
    const raw = offlineRaw(structuredClone(o), p, 14); // saved areas go through IndexedDB (structured clone)
    const a = interpret(p, 'auto', raw, new Date(2026, 6, 4));
    expect(a.water).toBe('lake');
    expect(a.lands[0]).toMatchObject({ key: 'USFS', name: 'United States Forest Service' });
    expect(a.regs?.special.map(g => g.code)).toEqual(['7.50(b)(158)']);
    expect(a.trout).toMatchObject({ open: true, daily: 5, source: '§7.50(b)(158)' });
    expect(interpret(p, 'auto', raw, new Date(2026, 11, 1)).trout?.open).toBe(false); // closed after Nov 15
    // Areas saved by the old route search have OSM lakes ({ name, lines }) instead of Esri water bodies.
    const old = { ...o, lakes: [{ name: 'Twin Lakes', lines: [lakeRing] }] };
    expect(interpret(p, 'auto', offlineRaw(old, p, 14), new Date(2026, 6, 4)).water).toBe('lake');
    const outside = interpret({ lat: 37.55, lng: -119.05 }, 'auto', offlineRaw(o, { lat: 37.55, lng: -119.05 }, 14), new Date(2026, 6, 4));
    expect(outside.regs?.special).toEqual([]);
  });
});
