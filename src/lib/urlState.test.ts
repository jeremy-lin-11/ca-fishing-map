import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, type UrlState } from './urlState';
import { DEFAULT_FILTERS } from './trails';
import { PUBLIC_LAND } from './land';

const defaults = { filters: DEFAULT_FILTERS, overlays: { land: true, regwaters: true, mpa: true, depth: true, rca: false } };

describe('shareable URL state', () => {
  it('round-trips a full state', () => {
    const s: UrlState = {
      map: { lat: 37.6234, lng: -119.0012, zoom: 12 }, tab: 'routes', point: { lat: 37.61, lng: -119.0 }, water: 'lake',
      overlays: { rca: true, depth: false }, mapLand: ['USFS', 'BLM'],
      filters: { ...DEFAULT_FILTERS, minMiles: 5, maxMiles: 20, maxWaterMeters: 800, tripStart: '2026-07-04', tripEnd: '2026-07-06',
        trout: 'keep', regs: 'special', sort: 'waters', excludeClosed: false, hikerOnly: false, publicOnly: false, landTypes: ['USFS', 'NPS'] },
      route: 'usfs:{8E5B2C1A-0000-4000-9000-ABCDEF012345}'
    };
    const hash = encodeState(s, defaults);
    const back = decodeState('#' + hash);
    expect(back.map).toEqual(s.map);
    expect(back).toMatchObject({ tab: 'routes', point: s.point, water: 'lake', overlays: { rca: true, depth: false }, mapLand: ['USFS', 'BLM'], route: s.route });
    expect(back.filters).toEqual({ minMiles: 5, maxMiles: 20, maxWaterMeters: 800, tripStart: '2026-07-04', tripEnd: '2026-07-06',
      trout: 'keep', regs: 'special', sort: 'waters', excludeClosed: false, hikerOnly: false, publicOnly: false, landTypes: ['USFS', 'NPS'] });
  });
  it('omits defaults, keeping links short', () => {
    const hash = encodeState({ map: { lat: 37.3, lng: -119.5, zoom: 6 }, tab: 'check', water: 'auto', mapLand: undefined,
      filters: { ...DEFAULT_FILTERS, tripStart: '', tripEnd: '', landTypes: PUBLIC_LAND } }, defaults);
    expect(hash).toBe('map=37.3000,-119.5000,6');
  });
  it('ignores malformed and unknown parts', () => {
    expect(decodeState('#map=999,abc,12&tab=evil&water=lava&mapland=USFS.NOPE&f=min:x,water:123,trip:2026-13..,trout:all,closed:2&route=')).toEqual({ mapLand: ['USFS'] });
    expect(decodeState('')).toEqual({});
  });
  it("accepts '+' that became a space in a pasted link", () => {
    expect(decodeState('#layers=+rca.-depth').overlays).toEqual({ rca: true, depth: false });
    expect(decodeState('#layers=%2Brca').overlays).toEqual({ rca: true });
  });
  it('clamps zoom', () => expect(decodeState('#map=37,-119,40').map?.zoom).toBe(19));
});
