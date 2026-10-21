import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OVERLAYS, type OverlayId } from './config';
import { fetchPoint, interpret, type Raw } from './lib/analyze';
import { clipToCalifornia, inCalifornia } from './lib/california';
import { areaFor, checkSaveArea, fetchOffline, offlineRaw, type SavedArea } from './lib/offline';
import { deleteArea, listAreas, putArea } from './lib/areaStore';
import { cacheTiles, tileUrls, uncacheTiles } from './lib/tiles';
import { decodeState, encodeState } from './lib/urlState';
import type { BBox } from './lib/geo';
import type { LatLng, WaterSelection } from './types';
import MapView from './components/MapView';
import Sidebar, { type Sheet } from './components/Sidebar';
import MapLayers, { type Basemap } from './components/MapLayers';
import ErrorBoundary from './components/ErrorBoundary';
import { DisclaimerGate } from './components/About';
import { ALL_LAND } from './lib/land';
import type { AgencyKey } from './regs';
import { track } from './posthog';

const defaultVisible = Object.fromEntries(OVERLAYS.map(o => [o.id, o.defaultOn])) as Record<OverlayId, boolean>;
// State from a shared link (read once, at load).
const shared = decodeState(window.location.hash);

export default function App() {
  const [visible, setVisible] = useState({ ...defaultVisible, ...shared.overlays });
  const [basemap, setBasemap] = useState<Basemap>('topo');
  const [sheet, setSheet] = useState<Sheet>('half'); // phone layout only
  const [mapLand, setMapLand] = useState<AgencyKey[]>(shared.mapLand ?? ALL_LAND);
  const [water, setWater] = useState<WaterSelection>(shared.water ?? 'auto');
  const [point, setPoint] = useState<LatLng | null>(null);
  const [raw, setRaw] = useState<Raw | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<(LatLng & { zoom?: number }) | null>(null);
  const [mapView, setMapView] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const latest = useRef(0);
  const view = useRef<{ bbox: BBox; zoom: number } | null>(null);

  // --- offline ---
  const [online, setOnline] = useState(navigator.onLine);
  const [areas, setAreas] = useState<SavedArea[]>([]);
  const [saving, setSaving] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [offlineFrom, setOfflineFrom] = useState<SavedArea | null>(null); // the saved area a fishing check was answered from
  const refreshAreas = useCallback(() => { if ('indexedDB' in window) listAreas().then(setAreas).catch(() => setAreas([])); }, []);
  useEffect(() => {
    refreshAreas();
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [refreshAreas]);
  const areasRef = useRef(areas); areasRef.current = areas;

  const checkPoint = useCallback(async (p: LatLng, zoom: number) => {
    if (!inCalifornia(p)) { setNotice('That point is outside California. This map only covers California and its coastal waters.'); return; }
    const id = ++latest.current; // ignore responses from older clicks
    setNotice(null);
    if (!navigator.onLine) { // answer from a saved area
      const area = areaFor(areasRef.current, p);
      if (!area) { setNotice("You're offline, and this point isn't in a saved area. Save areas for offline use (below) while online."); return; }
      setPoint(p); setOfflineFrom(area); setSheet(s => (s === 'min' ? 'half' : s)); setRaw(offlineRaw(area.offline, p, zoom)); setLoading(false);
      return;
    }
    setPoint(p); setLoading(true); setOfflineFrom(null); setSheet(s => (s === 'min' ? 'half' : s));
    const data = await fetchPoint(p, zoom);
    if (id !== latest.current) return;
    setRaw(data); setLoading(false);
  }, []);

  const onMapClick = (p: LatLng, zoom: number) => {
    track('fishing_check_requested', { online: navigator.onLine });
    checkPoint(p, zoom);
  };

  // Save the current map view (land, regulations, lakes and basemap tiles) for offline use.
  const onSaveArea = useCallback(async (name: string) => {
    const v = view.current;
    const bbox = v && clipToCalifornia(v.bbox);
    if (!bbox) { setSaveError('Pan to California to save an area.'); return; }
    const tooBig = checkSaveArea(bbox);
    if (tooBig) { setSaveError(tooBig); return; }
    setSaveError(null);
    try {
      setSaving({ phase: 'Downloading land, regulations and lakes', done: 0, total: 0 });
      const offline = await fetchOffline(bbox);
      const { urls, zMax } = tileUrls(bbox);
      setSaving({ phase: `Downloading basemap tiles (zoom 8–${zMax})`, done: 0, total: urls.length });
      const tileBytes = await cacheTiles(urls, (done, total) => setSaving(s => s && { ...s, done, total }));
      await navigator.storage?.persist?.(); // ask the browser not to evict saved areas under storage pressure
      await putArea({ id: crypto.randomUUID(), name: name.trim() || 'Saved area', bbox, savedAt: new Date().toISOString(), offline, tiles: urls, tileBytes });
      track('offline_area_saved');
      refreshAreas();
    } catch (e) {
      setSaveError(`Saving failed: ${(e as Error).message}`);
    } finally { setSaving(null); }
  }, [refreshAreas]);

  const onShowArea = useCallback((a: SavedArea) => {
    setFlyTarget({ lat: (a.bbox.south + a.bbox.north) / 2, lng: (a.bbox.west + a.bbox.east) / 2 });
  }, []);

  const onDeleteArea = useCallback(async (a: SavedArea) => {
    const keep = new Set(areasRef.current.filter(x => x.id !== a.id).flatMap(x => x.tiles)); // tiles shared with other areas stay
    await uncacheTiles(a.tiles, keep).catch(() => {});
    await deleteArea(a.id);
    track('offline_area_deleted');
    refreshAreas();
  }, [refreshAreas]);

  // Opening a shared link: re-run its point check once the map reports its view.
  const restored = useRef(false);
  const onView = useCallback((bbox: BBox, zoom: number) => {
    view.current = { bbox, zoom };
    setMapView({ lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2, zoom });
    if (restored.current) return;
    restored.current = true;
    if (shared.point) checkPoint(shared.point, zoom);
  }, [checkPoint]);

  // The URL changes only when the user copies a link: then it's set to the current view (replaceState: no history).
  const shareLink = useCallback(() => {
    const hash = encodeState({ map: mapView ?? undefined, point: point ?? undefined, water, overlays: visible, mapLand },
      { overlays: defaultVisible });
    window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname);
    return window.location.href;
  }, [mapView, point, water, visible, mapLand]);

  // A different link pasted into this tab: start from it. (Our own replaceState updates don't fire hashchange.)
  useEffect(() => {
    const onHash = () => window.location.reload();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Re-interpret instantly when the water type changes; no refetch needed.
  const result = useMemo(() => (point && raw ? interpret(point, water, raw) : null), [point, raw, water]);
  // One usage event per answered point (not again when only the water type changes): categories, no location.
  const tracked = useRef<LatLng | null>(null);
  useEffect(() => {
    if (!result || result.point === tracked.current) return;
    tracked.current = result.point;
    track('fishing_check_answered', { water: result.water, verdict: result.verdict.status, pressure: result.pressure?.level ?? null,
      source: offlineFrom ? 'offline_cache' : 'network', load_errors: result.errors.length });
  }, [result, offlineFrom]);

  return (
    <div id="app">
      <Sidebar sheet={sheet} onSheet={setSheet}
        water={water} onWater={setWater} onFly={setFlyTarget} loading={loading} result={result} notice={notice}
        online={online} offlineFrom={offlineFrom} near={mapView ?? undefined} onShareLink={shareLink}
        offline={{ online, areas, saving, error: saveError, onSave: onSaveArea, onShow: onShowArea, onDelete: onDeleteArea }} />
      <div id="mapwrap">
      <ErrorBoundary name="map">
      <MapView basemap={basemap} visible={visible} mapLand={mapLand} marker={point} flyTarget={flyTarget} onClick={onMapClick}
        initialView={shared.map} onView={onView} />
      </ErrorBoundary>
      <MapLayers basemap={basemap} onBasemap={b => { setBasemap(b); track('basemap_selected', { basemap: b }); }}
        visible={visible} onToggle={id => { track('map_overlay_toggled', { overlay: id, enabled: !visible[id] }); setVisible(v => ({ ...v, [id]: !v[id] })); }}
        mapLand={mapLand} onMapLand={setMapLand} />
      </div>
      <DisclaimerGate />
    </div>
  );
}
