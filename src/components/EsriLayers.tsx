// Thin react-leaflet wrappers around esri-leaflet layers: create on mount, remove on unmount.
// Data is only requested where it touches California; the basemap still shows everywhere.
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { createLayerComponent } from '@react-leaflet/core';
import * as esri from 'esri-leaflet';
import L from 'leaflet';
import { boxTouchesCalifornia, californiaQueryArea, CA_VISIBLE_BOUNDS } from '../lib/california';
import { queryPbf } from '../lib/pbfQuery';

interface FeatureProps {
  url: string;
  pane?: string;
  where?: string;
  minZoom?: number;
  maxZoom?: number;
  style: (props: Record<string, any>) => L.PathOptions;
  tooltip?: (props: Record<string, any>) => string;
}

// esri-leaflet loads features per grid cell, querying each cell's rectangle. On California's border
// that returns everything in the rectangle (35-59% of federal-land vertices at border views were in
// features wholly outside the state). We skip cells that miss California, and query border cells with
// the cell clipped to the state so the server never sends out-of-state features.
//
// esri-leaflet also re-downloads every cell at every zoom level (its cache is per level, and simplification follows
// the current zoom), which made zooming slow and jumpy. Here zoom levels share cells in pairs (8-9, 10-11, ...): at
// the odd level a cell is twice the pixels over the same ground, simplified the same, so its query is identical and
// comes from the response cache in pbfQuery.ts. Queries are protobuf, about a third of the bytes of gzipped GeoJSON.
//
// Overrides esri-leaflet 3.0.19 internals (FeatureGrid._isValidCell, _update, getCellSize, _cellCoordsToNwSe,
// FeatureManager._buildQuery, Query.run); see README.
const cellBox = (b: L.LatLngBounds) => ({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
const pairZoom = (z: number) => z - (z % 2);
const cellPx = (z: number) => 512 * 2 ** (z - pairZoom(z));
// Simplify to about half a screen pixel at the pair's even level, in degrees (queries use outSR 4326).
const tolerance = (z: number) => (0.5 * 360) / (256 * 2 ** pairZoom(z));
// One quantization grid for all cells, so features split across neighbouring cells line up exactly.
const QUANT_EXTENT = { xmin: -125, ymin: 32, xmax: -114, ymax: 42.5, spatialReference: { wkid: 4326 } };
const base = (esri.FeatureLayer as any).prototype;
export const CaliforniaFeatureLayer = (esri.FeatureLayer as any).extend({
  _isValidCell(coords: L.Coords) {
    return base._isValidCell.call(this, coords) && boxTouchesCalifornia(cellBox(this._cellCoordsToBounds(coords)));
  },
  // A view reset (a jump too far to pan, e.g. to a saved area) clears the grid's zoom and fires `move` before
  // restoring it; esri-leaflet would then lay out cells with no zoom (cell size NaN -> "Invalid LatLng"). The reset
  // rebuilds the grid right after, so skip that update.
  _update(center?: L.LatLng) {
    if (!Number.isFinite(this._cellZoom)) return;
    return base._update.call(this, center);
  },
  getCellSize() {
    const s = cellPx(this.zoomOr(this._cellZoom));
    return L.point(s, s);
  },
  // Per cell, since cells left over from the previous zoom level are a different size.
  _cellCoordsToNwSe(coords: L.Coords) {
    const z = this.zoomOr(coords.z), s = cellPx(z), nw = L.point(coords.x * s, coords.y * s);
    return [this._map.unproject(nw, z), this._map.unproject(nw.add([s, s]), z)];
  },
  zoomOr(z: number | undefined) {
    return Number.isFinite(z) ? z! : Math.round(this._map.getZoom());
  },
  _buildQuery(bounds: L.LatLngBounds, offset?: number) {
    const query = base._buildQuery.call(this, bounds, offset);
    const area = californiaQueryArea(cellBox(bounds));
    if (area?.type === 'clipped') query.intersects({ type: 'MultiPolygon', coordinates: area.polygon });
    const tol = tolerance(this._cellZoom);
    query.params.maxAllowableOffset = tol;
    query.params.quantizationParameters = { mode: 'view', originPosition: 'upperLeft', tolerance: tol / 2, extent: QUANT_EXTENT };
    const url = `${this.service.options.url}query`;
    query.run = (callback: (error?: Error, fc?: GeoJSON.FeatureCollection, response?: object) => void, context: unknown) => {
      queryPbf(url, query.params).then(
        r => callback.call(context, undefined, { type: 'FeatureCollection', features: r.features }, { exceededTransferLimit: r.exceededTransferLimit }),
        (e: Error) => { console.warn('Layer failed', url, e); callback.call(context, e); });
      return query;
    };
    return query;
  }
});

export function EsriFeatureLayer({ url, pane, where, minZoom, maxZoom, style, tooltip }: FeatureProps) {
  const map = useMap();
  useEffect(() => {
    const layer: esri.FeatureLayer = new CaliforniaFeatureLayer({
      url, pane, where: where || '1=1', minZoom, maxZoom, bounds: CA_VISIBLE_BOUNDS,
      // Features without a tooltip are display-only: not hit-tested on hover/click (thousands of land parcels
      // would make every mouse move scan them), and clicks fall through to the map for the fishing check.
      style: (f?: GeoJSON.Feature) => ({ ...style(f?.properties || {}), interactive: !!tooltip }),
      // Tooltip text comes from remote services: give Leaflet a text node, never an HTML string (it would use innerHTML).
      onEachFeature: tooltip ? (f: GeoJSON.Feature, l: L.Layer) => l.bindTooltip(document.createTextNode(tooltip(f.properties || {})) as unknown as HTMLElement, { sticky: true }) : undefined
    });
    layer.addTo(map);
    return () => { map.removeLayer(layer); };
    // Re-create only when the source changes; style/tooltip are treated as fixed for a layer's lifetime.
  }, [map, url, pane, where, minZoom, maxZoom]);
  return null;
}

// One exported image per view; only shown (and requested) while the view touches California.
export function EsriDynamicLayer({ url, opacity, pane }: { url: string; opacity: number; pane?: string }) {
  const map = useMap();
  useEffect(() => {
    const layer = esri.dynamicMapLayer({ url, opacity, pane, f: 'image' } as esri.DynamicMapLayerOptions);
    const sync = () => {
      const b = map.getBounds();
      const want = boxTouchesCalifornia({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      if (want && !map.hasLayer(layer)) layer.addTo(map);
      else if (!want && map.hasLayer(layer)) map.removeLayer(layer);
    };
    sync();
    map.on('moveend', sync);
    return () => { map.off('moveend', sync); map.removeLayer(layer); };
  }, [map, url, opacity, pane]);
  return null;
}

// ArcGIS image service as a basemap (e.g. NOAA relief). A real layer component so LayersControl can switch it.
export const EsriImageLayer = createLayerComponent<L.Layer, { url: string; attribution?: string }>(
  ({ url, attribution }, ctx) => ({ instance: esri.imageMapLayer({ url, attribution, format: 'jpgpng' } as esri.ImageMapLayerOptions), context: ctx })
);
