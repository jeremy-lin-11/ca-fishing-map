// ArcGIS feature queries as protobuf (f=pbf): about a third of the bytes of gzipped GeoJSON for the same features,
// and cheaper to parse. Responses stay in a small in-memory cache, so returning to a view doesn't download it again.
import decode from 'arcgis-pbf-parser';
import { http } from './http';

export interface PbfResult { features: GeoJSON.Feature[]; exceededTransferLimit: boolean }

// ArcGIS REST form encoding, as esri-leaflet's: arrays of scalars comma-joined, objects and object arrays as JSON.
export function encodeParams(params: Record<string, unknown>): string {
  return Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => {
    const s = Array.isArray(v) && typeof v[0] !== 'object' ? v.join(',') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    return `${encodeURIComponent(k)}=${encodeURIComponent(s)}`;
  }).join('&');
}

const CACHE_MAX = 100; // responses (map cells); a view is ~6-12 cells per layer
const cache = new Map<string, Promise<PbfResult>>();

// `url` is the layer's query endpoint (.../FeatureServer/0/query).
export function queryPbf(url: string, params: Record<string, unknown>): Promise<PbfResult> {
  const body = encodeParams({ ...params, f: 'pbf' });
  const key = `${url}?${body}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // most recently used last
  const p = fetchPbf(url, body);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return p;
}

async function fetchPbf(url: string, body: string): Promise<PbfResult> {
  // GET so the CDN can cache it, unless too long for a URL (border cells send the clipped state outline).
  const res = body.length < 1800 ? await http(`${url}?${body}`) : await http(url, { method: 'POST', body: new URLSearchParams(body) });
  if (!res.arrayBuffer) throw new Error('transport has no binary responses');
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Query errors come back as JSON ({"error": ...}) with status 200.
  if (bytes[0] === 0x7b) throw new Error(JSON.parse(new TextDecoder().decode(bytes)).error?.message ?? 'query failed');
  const { featureCollection, exceededTransferLimit } = decode(bytes);
  return { features: featureCollection.features, exceededTransferLimit };
}
