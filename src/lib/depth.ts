import { http } from './http';
import type { LatLng } from '../types';

export const M_PER_FATHOM = 1.8288;
export const FT_PER_M = 3.28084;

// Elevation (m) at a point from the NOAA DEM; negative = below sea level. null if unavailable.
export async function sampleDem(demUrl: string, p: LatLng): Promise<number | null> {
  try {
    const q = new URLSearchParams({
      geometry: JSON.stringify({ x: p.lng, y: p.lat, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPoint', returnFirstValueOnly: 'true', f: 'json'
    });
    const j = await (await http(`${demUrl}/getSamples?${q}`)).json();
    const v = j.samples?.length ? parseFloat(j.samples[0].value) : NaN;
    return isNaN(v) ? null : v;
  } catch { return null; }
}

// "RCA - 30-fm (55-m) Contour - ..." -> 30
export const rcaFathoms = (desc: string) => +((desc.match(/(\d+)-fm/) || [])[1] ?? NaN);

// On steep slopes many RCA lines fall within the search radius. Keep the ones closest to this depth.
export function nearestRcaLines(descs: string[], depthM: number | null, max = 2): string[] {
  const here = depthM != null && depthM > 0 ? depthM / M_PER_FATHOM : 0;
  return [...new Set(descs)].sort((x, y) => Math.abs(rcaFathoms(x) - here) - Math.abs(rcaFathoms(y) - here)).slice(0, max);
}
