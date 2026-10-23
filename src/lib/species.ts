// CDFW game fish ranges (RFRService GameFishRanges): per HUC12 watershed, a 1 for each species whose range includes
// it. Ranges, not surveys: largemouth bass and green sunfish are marked in almost every watershed, high Sierra ones
// included, so this says what may be in the watershed, never what is in this water. Plain data, no Leaflet.
import type { Attrs } from './arcgis';

export type SpeciesGroup = 'Trout, salmon & whitefish' | 'Bass' | 'Catfish' | 'Panfish' | 'Other';

// Field -> label, in display order. Fields CDFW adds later are ignored until listed here.
export const SPECIES: [string, string, SpeciesGroup][] = [
  ['RainbowTrout', 'Rainbow trout', 'Trout, salmon & whitefish'], ['BrownTrout', 'Brown trout', 'Trout, salmon & whitefish'],
  ['BrookTrout', 'Brook trout', 'Trout, salmon & whitefish'], ['CutthroatTrout', 'Cutthroat trout', 'Trout, salmon & whitefish'],
  ['SockeyeSalmon', 'Kokanee (sockeye salmon)', 'Trout, salmon & whitefish'], ['MountainWhitefish', 'Mountain whitefish', 'Trout, salmon & whitefish'],
  ['LargemouthBass', 'Largemouth bass', 'Bass'], ['SmallmouthBass', 'Smallmouth bass', 'Bass'],
  ['StripedBass', 'Striped bass', 'Bass'], ['WhiteBass', 'White bass', 'Bass'],
  ['ChannelCatfish', 'Channel catfish', 'Catfish'], ['BlueCatfish', 'Blue catfish', 'Catfish'], ['FlatheadCatfish', 'Flathead catfish', 'Catfish'],
  ['WhiteCatfish', 'White catfish', 'Catfish'], ['YellowBullhead', 'Yellow bullhead', 'Catfish'],
  ['Crappie', 'Crappie', 'Panfish'], ['GreenSunfish', 'Green sunfish', 'Panfish'],
  ['WhiteSturgeon', 'White sturgeon', 'Other'], ['AmericanShad', 'American shad', 'Other'], ['Carp', 'Carp', 'Other'],
  ['SpottedTilapia', 'Spotted tilapia', 'Other'], ['OrangemouthCorvina', 'Orangemouth corvina', 'Other'], ['Sargo', 'Sargo', 'Other']
];
export const SPECIES_FIELDS = ['Name', ...SPECIES.map(s => s[0])].join(',');

export interface Species { watersheds: string[]; groups: { group: SpeciesGroup; names: string[] }[] }

// Watersheds at the point (two on a boundary): a species counts if either range includes it.
export function speciesAt(rows: Attrs[]): Species | null {
  if (!rows.length) return null;
  const present = SPECIES.filter(([field]) => rows.some(r => Number(r[field]) === 1));
  const groups: Species['groups'] = [];
  for (const [, label, group] of present) {
    const g = groups.find(x => x.group === group);
    if (g) g.names.push(label); else groups.push({ group, names: [label] });
  }
  return { watersheds: [...new Set(rows.map(r => String(r.Name || '').trim()).filter(Boolean))], groups };
}
