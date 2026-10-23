import { describe, expect, it } from 'vitest';
import { lastAndNext, plantSites, plantStatus, plantSummary } from './plantings';

// Planting weeks start on Sunday; Oct 20, 2026 is a Tuesday.
const tue = new Date(2026, 9, 20, 10);
const row = (id: number, week: string, extra = {}) => ({ StockingWaterID: id, WaterName: 'Packer Lake', Counties: 'Sierra', Lat: 39.62, Lon: -120.65, WeekOfPlantStart: week, FishType: 'Trout', ...extra });

describe('fish plantings', () => {
  it('splits the last planting from this week or a scheduled one', () => {
    expect(lastAndNext([row(1, '2026-10-04'), row(1, '2026-10-25'), row(1, '2026-09-20')], tue))
      .toEqual({ last: { week: '2026-10-04', fish: 'Trout' }, next: { week: '2026-10-25', fish: 'Trout' } });
    expect(lastAndNext([row(1, '2026-10-18')], tue).next?.week).toBe('2026-10-18'); // this week counts as next
    expect(lastAndNext([], tue)).toEqual({ last: undefined, next: undefined });
  });
  it('groups rows into one site per water, colored by recency', () => {
    const sites = plantSites([row(1, '2026-10-04'), row(1, '2026-10-25'), row(2, '2026-09-27', { WaterName: 'Doane Pond' }),
      row(3, '2026-05-03', { WaterName: 'Old Pond' }), row(4, '2026-05-03', { Lat: null })], tue);
    expect(sites.map(s => [s.water, s.count, plantStatus(s, tue)])).toEqual([['Packer Lake', 2, 'upcoming'], ['Doane Pond', 1, 'recent'], ['Old Pond', 1, 'older']]);
    expect(plantSummary(sites[0])).toBe('Packer Lake (Sierra): trout planting scheduled the week of Oct 25; last planted trout the week of Oct 4');
  });
});
