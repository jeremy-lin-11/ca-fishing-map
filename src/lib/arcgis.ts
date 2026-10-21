import { http } from './http';
import type { LatLng } from '../types';

export type Attrs = Record<string, any>;

export async function arcQuery(layerUrl: string, params: Record<string, string>): Promise<Attrs[]> {
  const body = new URLSearchParams({ f: 'json', outFields: '*', returnGeometry: 'false', ...params });
  const j = await (await http(`${layerUrl}/query`, { method: 'POST', body })).json();
  if (j.error) throw new Error(j.error.message || 'ArcGIS query failed');
  return j.features.map((f: { attributes: Attrs }) => f.attributes);
}

// Features intersecting a point, or within `meters` of it.
export function queryPoint(layerUrl: string, p: LatLng, opts: { where?: string; meters?: number; outFields?: string } = {}) {
  return arcQuery(layerUrl, {
    where: opts.where || '1=1',
    geometry: `${p.lng},${p.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    ...(opts.outFields ? { outFields: opts.outFields } : {}),
    ...(opts.meters ? { distance: String(Math.round(opts.meters)), units: 'esriSRUnit_Meter' } : {})
  });
}

// Field names differ between services, so look up the first one that exists.
export function pick(a: Attrs, keys: string[]): string {
  for (const k of keys) {
    const v = a[k] ?? a[k.toUpperCase()] ?? a[k.toLowerCase()];
    if (v) return String(v);
  }
  return '';
}

// Features with geometry (outSR 4326), following exceededTransferLimit for up to `pages` pages.
export async function arcFeatures(url: string, params: Record<string, string>, pages = 5): Promise<{ attributes: Attrs; geometry: any }[]> {
  const out: { attributes: Attrs; geometry: any }[] = [];
  for (let page = 0; page < pages; page++) {
    const body = new URLSearchParams({ f: 'json', returnGeometry: 'true', outSR: '4326', resultOffset: String(out.length), ...params });
    const j = await (await http(`${url}/query`, { method: 'POST', body })).json();
    if (j.error) throw new Error(j.error.message || 'ArcGIS query failed');
    out.push(...j.features);
    if (!j.exceededTransferLimit) break;
  }
  return out;
}
