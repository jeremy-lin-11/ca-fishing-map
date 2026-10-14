import { describe, expect, it } from 'vitest';
import { districtScope, parseTrout, troutRule, type RegSummary } from './rules';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const period = (season: string, bag: string) => ({ season, ...parseTrout(bag) });
const sum = (o: Partial<RegSummary>): RegSummary => ({ code: 'x', desc: '', scope: 'water', closedAllYear: false, periods: [], ...o });

describe('trout bag parsing', () => {
  it('parses cells', () => {
    expect(parseTrout('2 trout. 4 trout in possession.')).toEqual({ daily: 2, possession: 4 });
    expect(parseTrout('2 hatchery trout or hatcherysteelhead* 4 hatchery trout or hatchery steelhead* in possession.')).toEqual({ daily: 2, possession: 4 });
    expect(parseTrout('Closed to the take of salmon.')).toEqual({ daily: null, possession: null });
  });
});

describe('troutRule', () => {
  // Crowley Lake §7.50(b)(38)(B): 5 trout until Jul 31, then artificial lures, 18" min, 2 trout through Nov 15.
  const crowley = sum({ code: '7.50(b)(38)(B)', periods: [
    period('Last Sat. in Apr. through Jul. 31.', '5 trout'),
    period('Aug. 1 through Nov. 15. Only artificial lures may be used. Minimum size limit: 18 inches total length.', '2 trout')] });
  it('picks the period that is open on the date', () => {
    expect(troutRule('lake', [crowley], [d(2026, 6, 1)])).toMatchObject({ open: true, keep: true, daily: 5, possession: 5 });
    expect(troutRule('lake', [crowley], [d(2026, 9, 1)])).toMatchObject({ open: true, daily: 2 });
    expect(troutRule('lake', [crowley], [d(2026, 12, 1)])).toMatchObject({ open: false, keep: false });
  });
  it('evaluates a trip across periods (most restrictive limit, closures reported)', () => {
    const trip = [d(2026, 7, 30), d(2026, 7, 31), d(2026, 8, 1), d(2026, 8, 2)];
    expect(troutRule('lake', [crowley], trip)).toMatchObject({ open: true, daily: 2 });
    const r = troutRule('lake', [crowley], [d(2026, 11, 14), d(2026, 11, 15), d(2026, 11, 16)]);
    expect(r).toMatchObject({ open: false, keep: false });
    expect(r.note).toMatch(/Closed on 1 of 3 days/);
  });
  it('catch-and-release and all-year closures', () => {
    const mcleod = sum({ code: '7.50(b)(92)', periods: [period('All year. Only artificial lures with barbless hooks may be used.', '0 trout')] });
    expect(troutRule('lake', [mcleod], [d(2026, 1, 5)])).toMatchObject({ open: true, keep: false, daily: 0 });
    expect(troutRule('stream', [sum({ closedAllYear: true })], [d(2026, 6, 1)])).toMatchObject({ open: false, keep: false, note: 'Closed to all fishing all year' });
  });
  it('statewide defaults with the stream season', () => {
    expect(troutRule('lake', [], [d(2026, 1, 10)])).toMatchObject({ open: true, daily: 5, possession: 10, source: 'statewide §5.85(a)(1)' });
    expect(troutRule('stream', [], [d(2026, 1, 10)])).toMatchObject({ open: false, source: 'statewide §5.85(a)(2)' });
    expect(troutRule('stream', [], [d(2026, 7, 4)])).toMatchObject({ open: true, daily: 5 });
  });
  it('a special season without a trout limit keeps the statewide limit', () => {
    const s = sum({ periods: [period('Sat. preceding Memorial Day through Sep. 30. Only artificial lures may be used.', '')] });
    expect(troutRule('stream', [s], [d(2026, 7, 1)])).toMatchObject({ open: true, daily: 5, possession: 10 });
  });
  it('district stream rules apply unless a special regulation does', () => {
    const northCentral = sum({ code: '7.00(c)(1)', scope: 'district-streams', desc: 'All North Central District streams…', closedAllYear: true });
    expect(troutRule('stream', [northCentral], [d(2026, 7, 1)])).toMatchObject({ open: false, source: '§7.00(c)(1)' });
    expect(troutRule('lake', [northCentral], [d(2026, 7, 1)])).toMatchObject({ open: true });                 // lakes unaffected
    const special = sum({ code: '7.50(b)(1)', periods: [period('Sat. preceding Memorial Day through Sep. 30.', '0 trout')] });
    expect(troutRule('stream', [northCentral, special], [d(2026, 7, 1)])).toMatchObject({ open: true, daily: 0, source: '§7.50(b)(1)' });
  });
  it('anadromous district rules are caveats, not answers', () => {
    const valley = sum({ code: '7.00(d)(1)', scope: 'district-anadromous', periods: [period('All year.', '2 hatchery trout or hatchery steelhead')] });
    const r = troutRule('stream', [valley], [d(2026, 7, 1)]);
    expect(r).toMatchObject({ open: true, daily: 5, source: 'statewide §5.85(a)(2)' });
    expect(r.caveats[0]).toMatch(/anadromous.*§7\.00\(d\)\(1\).*2 trout/);
  });
  it('unreadable seasons are unknown, not open', () => {
    const odd = sum({ periods: [period('See Klamath River subsection (b)(50).', '')] });
    expect(troutRule('stream', [odd], [d(2026, 7, 1)])).toMatchObject({ open: null, keep: null });
  });
});

describe('districtScope', () => {
  it('classifies §7.00 rows and drops salmon-only ones', () => {
    expect(districtScope(sum({ desc: 'All North Central District streams except those listed', closedAllYear: true }))).toBe('district-streams');
    expect(districtScope(sum({ desc: 'All Valley District anadromous waters except in the Special Regulations.', periods: [period('All year.', '2 hatchery trout')] }))).toBe('district-anadromous');
    expect(districtScope(sum({ desc: 'All rivers and associated tributaries above Lake Shasta', periods: [period('Closed to the take of salmon.', 'Closed to the take of salmon.')] }))).toBeNull();
  });
});
