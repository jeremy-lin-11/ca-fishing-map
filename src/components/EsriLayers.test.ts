// @vitest-environment happy-dom
// Regression: jumping the map far (a view reset, e.g. "Show on map" for a saved area) crashed the overlay grid with
// "Invalid LatLng object: (NaN, NaN)" because the zoom-pair overrides ran while the grid's zoom was cleared.
import { describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { setHttp } from '../lib/http';
import { CaliforniaFeatureLayer } from './EsriLayers';

describe('California feature layer grid', () => {
  it('survives a view reset (a jump too far to pan)', async () => {
    setHttp(async () => ({ json: async () => ({ features: [] }), arrayBuffer: async () => new ArrayBuffer(0) }));
    vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {}); // esri-leaflet's metadata request
    const div = document.createElement('div');
    Object.defineProperty(div, 'clientWidth', { value: 800 });
    Object.defineProperty(div, 'clientHeight', { value: 600 });
    document.body.appendChild(div);
    const map = L.map(div, { preferCanvas: true }).setView([37.6, -119.0], 12);
    const errors: unknown[] = [];
    window.addEventListener('error', e => errors.push(e.error));
    new CaliforniaFeatureLayer({ url: 'https://example.invalid/FeatureServer/0', minZoom: 8, style: () => ({}) }).addTo(map);
    expect(() => map.setView([33.0, -117.2], 12, { animate: false })).not.toThrow(); // ~550 km: reset, not a pan
    expect(() => map.setView([40.8, -124.1], 9, { animate: false })).not.toThrow();
    await new Promise(r => setTimeout(r, 50));
    expect(errors).toEqual([]);
    map.remove();
  });
});
