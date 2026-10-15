// Thin react-leaflet wrappers around esri-leaflet layers: create on mount, remove on unmount.
// Data is only requested where it touches California; the basemap still shows everywhere.
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { createLayerComponent } from '@react-leaflet/core';
import * as esri from 'esri-leaflet';
import type L from 'leaflet';
import { boxTouchesCalifornia, californiaQueryArea, CA_VISIBLE_BOUNDS } from '../lib/california';

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
// Overrides esri-leaflet 3.0.19 internals (FeatureGrid._isValidCell, FeatureManager._buildQuery); see README.
const cellBox = (b: L.LatLngBounds) => ({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
const base = (esri.FeatureLayer as any).prototype;
const CaliforniaFeatureLayer = (esri.FeatureLayer as any).extend({
  _isValidCell(coords: L.Coords) {
    return base._isValidCell.call(this, coords) && boxTouchesCalifornia(cellBox(this._cellCoordsToBounds(coords)));
  },
  _buildQuery(bounds: L.LatLngBounds, offset?: number) {
    const query = base._buildQuery.call(this, bounds, offset);
    const area = californiaQueryArea(cellBox(bounds));
    if (area?.type === 'clipped') query.intersects({ type: 'MultiPolygon', coordinates: area.polygon });
    return query;
  }
});

export function EsriFeatureLayer({ url, pane, where, minZoom, maxZoom, style, tooltip }: FeatureProps) {
  const map = useMap();
  useEffect(() => {
    const layer: esri.FeatureLayer = new CaliforniaFeatureLayer({
      url, pane, where: where || '1=1', minZoom, maxZoom, simplifyFactor: 0.5, precision: 5, bounds: CA_VISIBLE_BOUNDS,
      // Features without a tooltip are display-only: not hit-tested on hover/click (thousands of land parcels
      // would make every mouse move scan them), and clicks fall through to the map for the fishing check.
      style: (f?: GeoJSON.Feature) => ({ ...style(f?.properties || {}), interactive: !!tooltip }),
      onEachFeature: tooltip ? (f: GeoJSON.Feature, l: L.Layer) => l.bindTooltip(tooltip(f.properties || {}), { sticky: true }) : undefined
    });
    layer.on('requesterror', e => console.warn('Layer failed', url, e));
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
