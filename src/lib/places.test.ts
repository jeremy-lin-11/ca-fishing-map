import { describe, expect, it } from 'vitest';
import { normalize, searchPlaces, toPlaces } from './places';

const places = toPlaces([
  ['Mammoth Lakes', 'town', 37.6273, -118.9899, 7191], ['Bishop', 'town', 37.367, -118.396, 3819],
  ['Twin Lakes', 'lake', 37.616, -119.007], ['Twin Lakes', 'lake', 38.17, -119.37], ['Mammoth Creek', 'stream', 37.64, -118.95],
  ['Peñasquitos Creek', 'stream', 32.93, -117.19], ['Lake Mary', 'lake', 37.60, -119.01], ['Mammoth Pass Trail', 'trail', 37.61, -119.03]
]);

describe('place search', () => {
  it('normalizes accents and punctuation', () => expect(normalize("Peñasquitos  Creek's")).toBe('penasquitos creek s'));
  it('ranks exact, then prefix, then word-prefix; towns first on ties', () => {
    expect(searchPlaces(places, 'mammoth').map(p => p.name)).toEqual(['Mammoth Lakes', 'Mammoth Creek', 'Mammoth Pass Trail']);
    expect(searchPlaces(places, 'twin lak')[0]).toMatchObject({ name: 'Twin Lakes', kind: 'lake' });
    expect(searchPlaces(places, 'penasquitos')[0].name).toBe('Peñasquitos Creek');
  });
  it('tells same-named places apart by nearest town, and prefers the one near the view', () => {
    const hits = searchPlaces(places, 'twin lakes', { lat: 38.2, lng: -119.4 });
    expect(hits).toHaveLength(2);
    expect(hits[0].lat).toBe(38.17);
    expect(hits[1].near).toMatch(/Mammoth Lakes/);
  });
  it('needs at least two characters', () => expect(searchPlaces(places, 'm')).toEqual([]));
});
