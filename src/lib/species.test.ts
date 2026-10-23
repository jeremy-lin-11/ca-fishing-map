import { describe, expect, it } from 'vitest';
import { speciesAt } from './species';

describe('game fish ranges', () => {
  it('lists species by group, merging watersheds on a boundary', () => {
    expect(speciesAt([{ Name: 'Lake Tahoe', RainbowTrout: 1, LargemouthBass: 1, Carp: null }, { Name: 'Upper Truckee River', MountainWhitefish: 1, RainbowTrout: 1 }]))
      .toEqual({ watersheds: ['Lake Tahoe', 'Upper Truckee River'], groups: [
        { group: 'Trout, salmon & whitefish', names: ['Rainbow trout', 'Mountain whitefish'] }, { group: 'Bass', names: ['Largemouth bass'] }] });
    expect(speciesAt([{ Name: 'Dry Wash' }])).toEqual({ watersheds: ['Dry Wash'], groups: [] });
    expect(speciesAt([])).toBeNull();
  });
});
