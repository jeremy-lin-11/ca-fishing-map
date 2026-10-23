import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, type UrlState } from './urlState';

const defaults = { overlays: { land: true, regwaters: true, mpa: true, plantings: true, mussels: true, depth: true, rca: false } };

describe('shareable URL state', () => {
  it('round-trips a full state', () => {
    const s: UrlState = {
      map: { lat: 37.6234, lng: -119.0012, zoom: 12 }, point: { lat: 37.61, lng: -119.0 }, water: 'lake',
      overlays: { rca: true, depth: false }, mapLand: ['USFS', 'BLM']
    };
    expect(decodeState('#' + encodeState(s, defaults))).toEqual(s);
  });
  it('omits defaults, keeping links short', () => {
    expect(encodeState({ map: { lat: 37.3, lng: -119.5, zoom: 6 }, water: 'auto', mapLand: undefined }, defaults)).toBe('map=37.3000,-119.5000,6');
  });
  it('ignores malformed and unknown parts, including route-search parts of older links', () => {
    expect(decodeState('#map=999,abc,12&water=lava&mapland=USFS.NOPE&tab=routes&f=min:3&route=usfs:x')).toEqual({ mapLand: ['USFS'] });
    expect(decodeState('#pt=37.61,-119&tab=shore').point).toEqual({ lat: 37.61, lng: -119 });
    expect(decodeState('')).toEqual({});
  });
  it("accepts '+' that became a space in a pasted link", () => {
    expect(decodeState('#layers=+rca.-depth').overlays).toEqual({ rca: true, depth: false });
    expect(decodeState('#layers=%2Brca').overlays).toEqual({ rca: true });
  });
  it('clamps zoom', () => expect(decodeState('#map=37,-119,40').map?.zoom).toBe(19));
});
