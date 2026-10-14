// Visually clips a map pane to California and its coastal waters with a CSS clip-path.
// Features that cross the state line (e.g. a national forest extending into Nevada) are drawn only up to it.
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { CA_VISIBLE } from '../data/california';

// Leaflet's zoom animation timing (.leaflet-zoom-anim .leaflet-zoom-animated in leaflet.css).
const ZOOM_TRANSITION = 'clip-path 0.25s cubic-bezier(0,0,0.25,1)';

export default function CaliforniaClip({ pane }: { pane: string }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getPane(pane);
    if (!el) return;
    // Pane contents are positioned in layer points, so the clip is too. Layer points only change when
    // the pixel origin does (zoom / view reset), not when panning, since the pane moves with the map.
    const polygon = (toPoint: (ll: L.LatLng) => L.Point) =>
      `polygon(${CA_VISIBLE.map(([lng, lat]) => { const p = toPoint(L.latLng(lat, lng)); return `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`; }).join(',')})`;
    const apply = () => { el.style.transition = ''; el.style.clipPath = polygon(ll => map.latLngToLayerPoint(ll)); };
    // During the zoom animation layers scale toward their final position; animate the clip there in step.
    // (_latLngToNewLayerPoint is what Leaflet's own markers use for this.)
    const animate = (e: L.ZoomAnimEvent) => {
      el.style.transition = ZOOM_TRANSITION;
      el.style.clipPath = polygon(ll => (map as any)._latLngToNewLayerPoint(ll, e.zoom, e.center));
    };
    apply();
    map.on('zoomend viewreset', apply);
    map.on('zoomanim', animate as L.LeafletEventHandlerFn);
    return () => {
      map.off('zoomend viewreset', apply);
      map.off('zoomanim', animate as L.LeafletEventHandlerFn);
      el.style.clipPath = ''; el.style.transition = '';
    };
  }, [map, pane]);
  return null;
}
