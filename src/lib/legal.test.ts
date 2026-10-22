// Regressions for wrong legal answers found in review (each reproduced on live CDFW data first).
import { describe, expect, it } from 'vitest';
import { interpret, type Raw } from './analyze';
import { KINDS } from './regdata';
import { parseTrout } from './rules';
import { isOpenOn, parseSeason } from './season';

const HEADER = 'LIST[table header] Body of Water | Open Season and Special Restrictions | Daily Bag and Possession Limit';
const row = (name: string, season: string, bag: string) => `[table row] ${name} | ${season} | ${bag}`;
const [LAKES, STREAMS, , DISTRICTS] = KINDS;
const p = { lat: 38.7, lng: -123.4 };
const monJan = new Date(2027, 0, 11), monJul = new Date(2026, 6, 6);
const raw = (hits: Raw['regs']['hits'], rows: Record<string, string>, extra: Partial<Raw> = {}): Raw => ({
  own: [], waterBody: [], fed: [], parks: [], mpa: [], bay: [], nearBay: [], coastalBay: [],
  geo: { address: { state: 'California', county: 'Mendocino County' } }, dem: 100, rca: [], contours: [],
  regs: { hits, rowsByCode: new Map(Object.entries(rows).map(([code, verbatim]) => [code, { code, verbatim }])), failed: [] }, ...extra
});
const closedDistrict = { kind: DISTRICTS, desc: 'All North Coast District streams except those in the Special Regulations.', code: '7.00(c)(1)' };
const districtRows = { '7.00(c)': HEADER, '7.00(c)(1)': row('All streams', 'Closed to all fishing all year.', '') };

describe('legal answers', () => {
  it('a non-trout section on a special layer (§8.00 low-flow) does not replace a closed district rule', () => {
    const a = interpret(p, 'stream', raw([{ kind: STREAMS, desc: 'Low flow', code: '8.00(b)(2)' }, closedDistrict],
      { ...districtRows, '8.00(b)': 'Low-flow restrictions', '8.00(b)(2)': 'Mendocino County streams are closed when flows are low.' }), monJan);
    expect(a.trout?.open).toBe(false);
    expect(a.trout?.caveats.some(c => /low-flow/i.test(c))).toBe(true);
  });
  it("a whole river's entry: its reach decides, and alone it's unclear rather than closed", () => {
    const rows = { '7.40(b)': HEADER, '7.40(b)(79)': 'Russian River', '7.40(b)(79)(A)': row('Main stem below X', 'All year.', '2 hatchery trout'),
      '7.40(b)(79)(B)': row('Above X', 'Closed to all fishing all year.', '') };
    const parent = { kind: STREAMS, desc: 'Russian River', code: '7.40(b)(79)' }, reach = { kind: STREAMS, desc: 'Russian River', code: '7.40(b)(79)(A)' };
    expect(interpret(p, 'stream', raw([parent, reach], rows), monJan).trout).toMatchObject({ open: true, daily: 2 });
    const alone = interpret(p, 'stream', raw([parent], rows), monJan).trout!;
    expect(alone.open).toBeNull();
    expect(alone.note).toMatch(/differ along this water/);
  });
  it('"but only Sat., Sun., Wed." restricts the days even without "on"', () => {
    const s = parseSeason('Dec. 1 through Mar. 7, but only Sat., Sun., Wed., legal holidays and opening and closing days.');
    expect(isOpenOn(s, monJan)).toBe(false);                 // Monday
    expect(isOpenOn(s, new Date(2027, 0, 13))).toBe(true);    // Wednesday
  });
  it('"closed to the take of trout" is 0, and species-split limits are flagged', () => {
    expect(parseTrout('Closed to the take of trout and steelhead.')).toMatchObject({ daily: 0, possession: 0 });
    expect(parseTrout('5 brown trout, 0 Rainbow Trout')).toMatchObject({ daily: 5, bySpecies: '5 brown trout, 0 Rainbow Trout' });
    expect(parseTrout('5 trout. 10 in possession')).toEqual({ daily: 5, possession: 10 });
  });
  it('missing regulation text or an unverified-only rule is unclear, never a default "open"', () => {
    const lakeHit = { kind: LAKES, desc: 'A Lake', code: '7.50(b)(1)' };
    const failed = interpret(p, 'lake', { ...raw([lakeHit], {}), regs: { hits: [lakeHit], rowsByCode: new Map(), failed: ['regulation text'] } }, monJul);
    expect(failed.trout).toMatchObject({ open: null, keep: null });
    const unverified = interpret(p, 'lake', raw([{ ...lakeHit, unverified: true }], { '7.50(b)': HEADER, '7.50(b)(1)': row('A Lake', 'Closed to all fishing all year.', '') }), monJul);
    expect(unverified.trout?.open).toBeNull();
  });
  it("a failed land or MPA check can't produce a green verdict", () => {
    expect(interpret(p, 'stream', raw([], {}, { own: null }), monJul).verdict.status).toBe('warn');
    const ocean = interpret({ lat: 36.5, lng: -121.95 }, 'ocean', raw([], {}, { mpa: null, dem: -50, geo: null }), monJul);
    expect(ocean.verdict).toMatchObject({ status: 'warn', text: expect.stringMatching(/marine protected areas/) });
  });
});
