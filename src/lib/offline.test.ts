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
  it('saved San Francisco Bay outline: bay water, and salt ponds within 1.5 km of it', () => {
    const bayRing = [[-122.2, 37.45], [-122.0, 37.45], [-122.0, 37.6], [-122.2, 37.6], [-122.2, 37.45]] as [number, number][];
    const pondRing = [[-122.045, 37.43], [-122.035, 37.43], [-122.035, 37.44], [-122.045, 37.44], [-122.045, 37.43]] as [number, number][];
    const o: OfflineData = { bbox: { south: 37.3, west: -122.3, north: 37.7, east: -121.9 }, land: [], regFeatures: [], regRows: [],
      lakes: [{ rings: [pondRing], attrs: { NAME: ' ', FTYPE: 'Reservoir', FCODE_DESC: 'Reservoir: Reservoir Type = Evaporator' } }], bay: [[bayRing]] };
    expect(interpret({ lat: 37.5, lng: -122.1 }, 'auto', offlineRaw(o, { lat: 37.5, lng: -122.1 }, 14)).water).toBe('ocean');
    const pond = { lat: 37.439, lng: -122.04 }; // in the pond, ~1.2 km south of the bay edge
    expect(interpret(pond, 'auto', offlineRaw(o, pond, 14)).water).toBe('ocean');
    expect(interpret(pond, 'auto', offlineRaw({ ...o, bay: undefined }, pond, 14)).water).toBe('stream'); // older save: no outline
  });
  it('saved coastal bay outlines: ocean rules inside them', () => {
    const ring = [[-117.25, 32.76], [-117.2, 32.76], [-117.2, 32.8], [-117.25, 32.8], [-117.25, 32.76]] as [number, number][];
    const o: OfflineData = { bbox: { south: 32.7, west: -117.3, north: 32.85, east: -117.1 }, land: [], regFeatures: [], regRows: [], lakes: [],
      coastalBays: [{ name: 'Mission Bay', rings: [ring] }] };
    const p = { lat: 32.775, lng: -117.225 };
    expect(interpret(p, 'auto', offlineRaw(o, p, 14)).notes.some(n => n.strong === 'Mission Bay')).toBe(true);
    expect(interpret(p, 'auto', offlineRaw({ ...o, coastalBays: undefined }, p, 14)).water).not.toBe('lake');
  });
  it('saved MPAs: a no-take reserve offline is not "legal"; open ocean is ocean', () => {
    const ring = [[-121.96, 36.51], [-121.93, 36.51], [-121.93, 36.53], [-121.96, 36.53], [-121.96, 36.51]] as [number, number][];
    const o: OfflineData = { bbox: { south: 36.4, west: -122.1, north: 36.6, east: -121.8 }, land: [], regFeatures: [], regRows: [], lakes: [],
      mpas: [{ rings: [ring], attrs: { name: 'Point Lobos SMR', fullname: 'Point Lobos State Marine Reserve', type: 'SMR' } }] };
    const inReserve = { lat: 36.52, lng: -121.945 }, offshore = { lat: 36.5, lng: -122.05 };
    expect(interpret(inReserve, 'auto', offlineRaw(o, inReserve, 14)).verdict.status).toBe('no');
    expect(interpret(offshore, 'auto', offlineRaw(o, offshore, 14)).water).toBe('ocean');
    const old = { ...o, mpas: undefined }; // saved before MPAs were saved, on the coast: the MPA check is reported missing
    expect(interpret(offshore, 'auto', offlineRaw(old, offshore, 14)).verdict.status).toBe('warn');
  });
});
