import { describe, expect, it } from 'vitest';
import { bluffFrom, DEFAULT_SHORE_FILTERS, filterSpots, groundfishAreaAt, rateDifficulty, type ShoreResult, type ShoreSpot } from './shore';

describe('shore spots', () => {
  it('rates difficulty from bluff height, steepness, path and rock type', () => {
    expect(rateDifficulty(2, false, true, 'platform').difficulty).toBe('easy');
    expect(rateDifficulty(1, false, null, 'structure').difficulty).toBe('easy');   // jetty/riprap at the water
    expect(rateDifficulty(8, false, true, 'platform').difficulty).toBe('moderate');
    expect(rateDifficulty(3, false, null, 'cliff').difficulty).toBe('moderate');
    expect(rateDifficulty(22, true, true, 'cliff').difficulty).toBe('hard');
    expect(rateDifficulty(7, true, null, 'talus').difficulty).toBe('hard');      // sheer with no known path
    expect(rateDifficulty(null, false, null, 'cliff').difficulty).toBe('hard');
    expect(rateDifficulty(22, true, true, 'cliff').why).toMatch(/22 m bluff, sheer; mapped path/);
  });
  it('measures bluff height and steepness from a waterline transect (0,10,20,30,45,60 m)', () => {
    expect(bluffFrom([1, 2, 2.5, 3, 3.5, 4])).toEqual({ bluffM: 3, sheer: false });       // low bench
    expect(bluffFrom([0.5, 15, 22, 24, 25, 25])).toEqual({ bluffM: 24.5, sheer: true });  // 14.5 m rise in 10 m
    expect(bluffFrom([-1.2, 0, 4, 8, 12, 16]).bluffM).toBe(16);                           // DEM below 0 at the water
    expect(bluffFrom([null, null, 3, null, null, null]).bluffM).toBeNull();
  });
  it('knows the groundfish management areas by latitude', () => {
    expect(groundfishAreaAt(41.5)).toBe('Northern');
    expect(groundfishAreaAt(39.5)).toBe('Mendocino');
    expect(groundfishAreaAt(37.6)).toBe('San Francisco');
    expect(groundfishAreaAt(36.5)).toBe('Central');
    expect(groundfishAreaAt(33.0)).toBe('Southern');
  });
  it('filters without dropping hard spots by default; no-take MPAs hidden unless asked', () => {
    const spot = (o: Partial<ShoreSpot>): ShoreSpot => ({ id: Math.random().toString(), name: 'x', source: 'access point', at: [0, 0], rockAt: [0, 0], rockMeters: 10,
      habitat: { score: 100, meters: {} }, bluffM: 5, sheer: false, pathDown: true, difficulty: 'easy', difficultyWhy: '', mpa: null, groundfishArea: 'Central',
      closed: null, publicLand: null, features: {}, ...o });
    const r: ShoreResult = { bbox: { south: 0, west: 0, north: 1, east: 1 }, rock: [], errors: [], spots: [
      spot({ name: 'cliff', difficulty: 'hard', habitat: { score: 900, meters: {} } }), spot({ name: 'bench', habitat: { score: 300, meters: {} } }),
      spot({ name: 'reserve', mpa: { name: 'SMR', type: 'SMR', status: 'no', text: '' }, habitat: { score: 950, meters: {} } }),
      spot({ name: 'closed', closed: 'Closed 2026-01-01' }), spot({ name: 'trail', source: 'trail', difficulty: 'moderate' })] };
    expect(filterSpots(r, DEFAULT_SHORE_FILTERS).map(s => s.name)).toEqual(['cliff', 'bench', 'trail']); // ranked by habitat
    expect(filterSpots(r, { ...DEFAULT_SHORE_FILTERS, sort: 'easiest' })[0].name).toBe('bench');
    expect(filterSpots(r, { ...DEFAULT_SHORE_FILTERS, showNoTake: true })[0].name).toBe('reserve');
    expect(filterSpots(r, { ...DEFAULT_SHORE_FILTERS, difficulty: ['easy'], includeTrails: false }).map(s => s.name)).toEqual(['bench']);
  });
});
