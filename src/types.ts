export interface LatLng { lat: number; lng: number }
export type Status = 'ok' | 'warn' | 'no';
export type WaterType = 'stream' | 'lake' | 'ocean';
export type WaterSelection = WaterType | 'auto';

// One line of text in a result card. Kept structured (not HTML) so React renders it safely.
export interface Note {
  strong?: string;
  text?: string;
  italic?: string;
  hint?: string;
  link?: { href: string; label: string };
}
