import { describe, expect, it } from 'vitest';
import { daysBetween, isOpenOn, parseEndpoint, parseSeason } from './season';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;

describe('season endpoints (2026)', () => {
  it.each([
    ['Sep. 30', '2026-9-30'], ['September 15', '2026-9-15'], ['Feb.15', '2026-2-15'], ['Oct 31', '2026-10-31'],
    ['the last day in Feb.', '2026-2-28'], ['Last Sat. in Apr.', '2026-4-25'], ['Fourth Sat. in May', '2026-5-23'],
    ['the fourth Fri. in May', '2026-5-22'], ['Sat. preceding Memorial Day', '2026-5-23'],  // Memorial Day = May 25, 2026
    ['the Fri. preceding the last Sat. in Apr.', '2026-4-24'], ['Memorial Day', '2026-5-25'], ['Labor Day', '2026-9-7']
  ])('%s', (text, want) => expect(ymd(parseEndpoint(text)!(2026))).toBe(want));
  it('leap years', () => expect(ymd(parseEndpoint('last day in Feb.')!(2028))).toBe('2028-2-29'));
  it('rejects unknown phrases', () => expect(parseEndpoint('when the department determines')).toBeNull());
});

describe('seasons', () => {
  it('reads simple and wrapping ranges', () => {
    const general = parseSeason('Last Sat. in Apr. through Nov. 15. Only artificial lures may be used.');
    expect(isOpenOn(general, d(2026, 4, 24))).toBe(false);
    expect(isOpenOn(general, d(2026, 4, 25))).toBe(true);
    expect(isOpenOn(general, d(2026, 11, 15))).toBe(true);
    expect(isOpenOn(general, d(2026, 11, 16))).toBe(false);
    const winter = parseSeason('Nov. 16 through the Fri. preceding the last Sat. in Apr. Only artificial lures with barbless hooks may be used.');
    expect(isOpenOn(winter, d(2026, 12, 1))).toBe(true);
    expect(isOpenOn(winter, d(2027, 1, 10))).toBe(true);
    expect(isOpenOn(winter, d(2026, 4, 24))).toBe(true);
    expect(isOpenOn(winter, d(2026, 4, 25))).toBe(false);
    expect(isOpenOn(parseSeason('Sat. preceding Memorial Day through the last day in Feb.'), d(2027, 2, 1))).toBe(true);
  });
  it('handles all-year, closures, weekday-only seasons and unknowns', () => {
    expect(isOpenOn(parseSeason('All year.'), d(2026, 1, 3))).toBe(true);
    expect(isOpenOn(parseSeason('Closed to all fishing all year for safety purposes.'), d(2026, 6, 1))).toBe(false);
    const steelhead = parseSeason('Dec. 1 through Mar. 7, but only on Sat., Sun., Wed., legal holidays and opening and closing days.');
    expect(isOpenOn(steelhead, d(2026, 12, 5))).toBe(true);  // Saturday
    expect(isOpenOn(steelhead, d(2026, 12, 7))).toBe(false); // Monday
    expect(parseSeason('Closed to the take of salmon.')).toBeNull();
    expect(parseSeason('Closed to all fishing from Apr. 1 through Jun. 15.')).toBeNull();
  });
  it('accepts CDFW variants', () => {
    expect(isOpenOn(parseSeason('Jan. 1 to Aug. 14.'), d(2026, 8, 1))).toBe(true);
    expect(isOpenOn(parseSeason('Sat. preceding Memorial through the last day in Feb.'), d(2026, 5, 23))).toBe(true);
    expect(isOpenOn(parseSeason('Fourth Sat. in in May through Jul. 15.'), d(2026, 5, 23))).toBe(true);
    expect(parseSeason('From Parker Lake to the confluence with Rush Creek.')).toBeNull();
  });
  it('lists trip days', () => expect(daysBetween(d(2026, 7, 30), d(2026, 8, 2)).map(ymd)).toEqual(['2026-7-30', '2026-7-31', '2026-8-1', '2026-8-2']));
});
