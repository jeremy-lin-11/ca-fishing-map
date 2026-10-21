// Live check of the map layers' protobuf queries (`npm run test:live`): same features as GeoJSON, within tolerance.
import { execFileSync } from 'node:child_process';
import { beforeAll, expect, it } from 'vitest';
import { setHttp } from './http';
import { encodeParams, queryPbf } from './pbfQuery';
import { CONFIG } from '../config';

let calls = 0;
const curl = (url: string, body?: URLSearchParams) =>
  execFileSync('curl', ['-sS', '-m', '120', '--compressed', ...(body ? ['--data', String(body)] : []), url], { maxBuffer: 2e8 });
beforeAll(() => setHttp(async (url, init) => {
  calls++;
  const out = curl(url, init?.body);
  return { json: async () => JSON.parse(out.toString()), arrayBuffer: async () => out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) };
}));

it('land ownership PBF matches GeoJSON and is cached', async () => {
  const tol = (0.5 * 360) / (256 * 2 ** 10); // EsriLayers' zoom-10 tolerance
  const extent = { xmin: -119.3, ymin: 37.4, xmax: -118.95, ymax: 37.68, spatialReference: { wkid: 4326 } }; // Mammoth
  const params = { returnGeometry: true, where: '1=1', outSR: 4326, outFields: '*', inSR: 4326, geometry: extent,
    geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects', resultType: 'tile', maxAllowableOffset: tol };
  const url = `${CONFIG.layers.ownership.url}/query`;
  const pbf = await queryPbf(url, { ...params, quantizationParameters: { mode: 'view', originPosition: 'upperLeft', tolerance: tol / 2,
    extent: { xmin: -125, ymin: 32, xmax: -114, ymax: 42.5, spatialReference: { wkid: 4326 } } } });
  const geo = JSON.parse(curl(`${url}?${encodeParams({ ...params, f: 'geojson' })}`).toString()) as GeoJSON.FeatureCollection;

  expect(pbf.features.length).toBeGreaterThan(10);
  expect(pbf.features.map(f => f.id).sort()).toEqual(geo.features.map(f => f.id).sort());
  expect(pbf.features[0].properties).toHaveProperty('Own_Agency');
  // Every decoded vertex lies within the quantization tolerance of some vertex of the GeoJSON feature.
  const pts = (c: any): number[][] => (typeof c[0] === 'number' ? [c] : c.flatMap(pts));
  const ref = new Map(geo.features.map(f => [f.id, pts((f.geometry as GeoJSON.Polygon).coordinates)]));
  let worst = 0;
  for (const f of pbf.features) {
    const r = ref.get(f.id)!;
    for (const [x, y] of pts((f.geometry as GeoJSON.Polygon).coordinates))
      worst = Math.max(worst, Math.min(...r.map(([a, b]) => Math.max(Math.abs(a - x), Math.abs(b - y)))));
  }
  console.log(`${pbf.features.length} features, worst vertex offset ${worst.toExponential(1)}° (tolerance ${tol.toExponential(1)}°)`);
  expect(worst).toBeLessThan(tol);

  const before = calls;
  await queryPbf(url, { ...params, quantizationParameters: { mode: 'view', originPosition: 'upperLeft', tolerance: tol / 2,
    extent: { xmin: -125, ymin: 32, xmax: -114, ymax: 42.5, spatialReference: { wkid: 4326 } } } });
  expect(calls).toBe(before); // second identical query: from the cache
}, 120_000);
