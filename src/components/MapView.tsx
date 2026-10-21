import { useEffect } from 'react';
import { CircleMarker, MapContainer, Pane, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { BASEMAPS, CONFIG, type OverlayId } from '../config';
import { AGENCY_COLORS } from '../regs';
import { ALL_LAND, ownershipKey, ownershipWhere } from '../lib/land';
import type { AgencyKey } from '../regs';
import type { LatLng } from '../types';
import { EsriDynamicLayer, EsriFeatureLayer, EsriImageLayer } from './EsriLayers';
import CaliforniaClip from './CaliforniaClip';
import LocateControl from './LocateControl';
import type { Basemap } from './MapLayers';
import { CA_RINGS } from '../data/california';
import type { BBox } from '../lib/geo';

// Data overlays live in their own pane (same stacking as Leaflet's overlayPane), clipped to California.
const DATA = 'caData';
const STATE_LINE = CA_RINGS.map(r => r.map(([lng, lat]) => [lat, lng] as [number, number]));

const landStyle = (p: Record<string, any>): L.PathOptions => {
  const c = AGENCY_COLORS[ownershipKey(p)];
  return { color: c, weight: 1, fillColor: c, fillOpacity: 0.35 };
};
const mpaStyle = (): L.PathOptions => ({ color: '#0077b6', weight: 1.5, fillColor: '#0096c7', fillOpacity: 0.3, dashArray: '4 3' });
const regStyle: L.PathOptions = { color: '#e76f00', weight: 2, fillColor: '#f4a261', fillOpacity: 0.35 };
const regLakeStyle = () => regStyle;
const regStreamStyle = () => ({ ...regStyle, weight: 3 });
const rcaStyle = (): L.PathOptions => ({ color: '#c1121f', weight: 1.5, dashArray: '6 4' });
const rcaTooltip = (p: Record<string, any>) => String(p.feat_desc ?? '');
const contourStyle = (): L.PathOptions => ({ color: '#1d4e89', weight: 1 });

function ClickHandler({ onClick }: { onClick: (p: LatLng, zoom: number) => void }) {
  const map = useMapEvents({ click: e => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }, map.getZoom()) });
  return null;
}

function ViewReporter({ onView }: { onView: (b: BBox, zoom: number) => void }) {
  const map = useMapEvents({ moveend: () => report(), zoomend: () => report() });
  const report = () => {
    const b = map.getBounds();
    onView({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, map.getZoom());
  };
  useEffect(report, []); // initial view
  return null;
}

function FlyTo({ target }: { target: (LatLng & { zoom?: number }) | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.setView([target.lat, target.lng], target.zoom ?? 12); }, [map, target]);
  return null;
}

interface Props {
  basemap: Basemap;
  visible: Record<OverlayId, boolean>;
  mapLand: AgencyKey[];
  marker: LatLng | null;
  flyTarget: (LatLng & { zoom?: number }) | null;
  onClick: (p: LatLng, zoom: number) => void;
  onView: (b: BBox, zoom: number) => void;
  initialView?: { lat: number; lng: number; zoom: number }; // from a shared link
}

export default function MapView({ basemap, visible, mapLand, marker, flyTarget, onClick, onView, initialView }: Props) {
  const { layers, regs, depth } = CONFIG;
  // Unchecked land types are filtered on the server, so they're never downloaded.
  const landWhere = ownershipWhere(ALL_LAND.filter(k => mapLand.includes(k)));
  const coarseWhere = landWhere === '1=1' ? layers.ownership.coarseWhere : `(${layers.ownership.coarseWhere}) AND (${landWhere})`;
  return (
    // preferCanvas: vector layers paint to one <canvas> per pane instead of one SVG element per feature. Land
    // ownership alone can put 5,000-12,000 parcels in view, which as SVG locked up the page.
    // Wheel: gather a trackpad gesture into one zoom step (Leaflet's 40 ms / 60 px turned one swipe into several
    // jumps, each reloading the data layers).
    <MapContainer id="map" preferCanvas wheelDebounceTime={100} wheelPxPerZoomLevel={120} {...(initialView ? { center: [initialView.lat, initialView.lng] as [number, number], zoom: initialView.zoom } : { bounds: CONFIG.bounds })} maxBounds={L.latLngBounds(CONFIG.bounds).pad(1)}>
      {basemap === 'topo' && <TileLayer url={BASEMAPS.usgsTopo} maxNativeZoom={16} attribution="USGS The National Map" />}
      {basemap === 'imagery' && <TileLayer url={BASEMAPS.usgsImagery} maxNativeZoom={16} attribution="USGS The National Map" />}
      {basemap === 'relief' && <EsriImageLayer url={BASEMAPS.noaaRelief} attribution="NOAA NCEI" />}

      {/* Pane children render only once the pane exists, so each clip goes inside its pane. */}
      <Pane name={DATA} style={{ zIndex: 400 }}><CaliforniaClip pane={DATA} /></Pane>

      {visible.land && mapLand.length > 0 && <>
        {/* Large holders only at low zoom; every owner (cities, districts, nonprofits) from zoom 10. */}
        {/* Zoom 7 would draw ~29,000 parcels, so land starts at 8: large holders at 8-9, every owner from 10.
            The owner of any point shows in the fishing check, so parcels have no hover tooltips. */}
        <EsriFeatureLayer pane={DATA} url={layers.ownership.url} where={coarseWhere} minZoom={8} maxZoom={9} style={landStyle} />
        <EsriFeatureLayer pane={DATA} url={layers.ownership.url} where={landWhere} minZoom={10} style={landStyle} />
      </>}
      {visible.mpa && <EsriFeatureLayer pane={DATA} url={layers.mpa.url} minZoom={6} style={mpaStyle} />}
      {visible.regwaters && <>
        <EsriFeatureLayer pane={DATA} url={`${regs.url}/${regs.layers.lakes}`} minZoom={8} style={regLakeStyle} />
        <EsriFeatureLayer pane={DATA} url={`${regs.url}/${regs.layers.streams}`} minZoom={9} style={regStreamStyle} />
      </>}
      {visible.depth && <>
        <EsriDynamicLayer pane={DATA} url={depth.oceanContours} opacity={0.85} />
        {depth.lakeTiles.map(lk => (
          <TileLayer key={lk.name} pane={DATA} url={`${lk.url}/tile/{z}/{y}/{x}`} bounds={lk.bounds} maxNativeZoom={lk.maxZoom} opacity={0.75} attribution={lk.source} />
        ))}
        {depth.lakeContours.map(lk => (
          <EsriFeatureLayer key={lk.name} pane={DATA} url={lk.url} where={lk.where} minZoom={9} style={contourStyle}
            tooltip={p => `${lk.name}: bottom ${p[lk.field]} ft elev.`} />
        ))}
      </>}
      {visible.rca && <EsriFeatureLayer pane={DATA} url={depth.rca} minZoom={7} style={rcaStyle} tooltip={rcaTooltip} />}

      <Polyline positions={STATE_LINE} interactive={false} pathOptions={{ color: '#57606a', weight: 1.5, opacity: 0.8 }} />

      {marker && <CircleMarker center={[marker.lat, marker.lng]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#1f6feb', fillOpacity: 1 }} />}
      <ClickHandler onClick={onClick} />
      <ViewReporter onView={onView} />
      <FlyTo target={flyTarget} />
      <LocateControl />
    </MapContainer>
  );
}
