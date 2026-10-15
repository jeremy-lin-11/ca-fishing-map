import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OVERLAYS, type OverlayId } from './config';
import { fetchPoint, interpret, type Raw } from './lib/analyze';
import { clipToCalifornia, inCalifornia } from './lib/california';
import { checkSearchArea, DEFAULT_FILTERS, filterRoutes, type Prepared, type RouteFilters, type WaterAccess } from './lib/trails';
import { fetchAreaForOffline, searchArea, searchShore } from './lib/routeSearch';
import { DEFAULT_SHORE_FILTERS, filterSpots, type ShoreFilters, type ShoreResult, type ShoreSpot } from './lib/shore';
import { bboxSpanKm } from './lib/geo';
import { CONFIG } from './config';
import { areaFor, offlineRaw, type SavedArea } from './lib/offline';
import { deleteArea, listAreas, putArea } from './lib/areaStore';
import { cacheTiles, tileUrls, uncacheTiles } from './lib/tiles';
import { decodeState, encodeState } from './lib/urlState';
import type { BBox } from './lib/geo';
import type { LatLng, WaterSelection } from './types';
import MapView from './components/MapView';
import Sidebar, { type Sheet, type Tab } from './components/Sidebar';
import MapLayers, { type Basemap } from './components/MapLayers';
import ErrorBoundary from './components/ErrorBoundary';
import { DisclaimerGate } from './components/About';
import { ALL_LAND } from './lib/land';
import type { AgencyKey } from './regs';

const defaultVisible = Object.fromEntries(OVERLAYS.map(o => [o.id, o.defaultOn])) as Record<OverlayId, boolean>;
// State from a shared link (read once, at load).
const shared = decodeState(window.location.hash);

export default function App() {
  const [tab, setTab] = useState<Tab>(shared.tab ?? 'check');
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

  const [filters, setFilters] = useState<RouteFilters>({ ...DEFAULT_FILTERS, ...shared.filters });
  const [routeData, setRouteData] = useState<Prepared | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const pendingRoute = useRef<string | null>(shared.route ?? null); // a shared link's route, selected once its search returns

  // --- shore spots ---
  const [shoreFilters, setShoreFilters] = useState<ShoreFilters>(DEFAULT_SHORE_FILTERS);
  const [shoreResult, setShoreResult] = useState<ShoreResult | null>(null);
  const [shoreLoading, setShoreLoading] = useState(false);
  const [shoreError, setShoreError] = useState<string | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null);
  const onSearchShore = useCallback(async () => {
    const v = view.current;
    const bbox = v && clipToCalifornia(v.bbox);
    if (!bbox) { setShoreError('Pan to the California coast to search for shore spots.'); return; }
    const { ns, ew } = bboxSpanKm(bbox), max = CONFIG.shore.maxSearchKm;
    if (ns > max || ew > max) { setShoreError(`Zoom in: the search area is ${Math.round(Math.max(ns, ew))} km across (max ${max} km).`); return; }
    setShoreError(null); setShoreLoading(true); setSelectedSpot(null); setSheet(s => (s === 'min' ? 'half' : s));
    try { setShoreResult(await searchShore(bbox)); }
    catch (e) { setShoreError(`Search failed: ${(e as Error).message}`); }
    finally { setShoreLoading(false); }
  }, []);
  const shoreSpots = useMemo(() => (shoreResult ? filterSpots(shoreResult, shoreFilters) : null), [shoreResult, shoreFilters]);

  // --- offline ---
  const [online, setOnline] = useState(navigator.onLine);
  const [areas, setAreas] = useState<SavedArea[]>([]);
  const [saving, setSaving] = useState<{ phase: string; done: number; total: number } | null>(null);
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
      if (!area) { setNotice("You're offline, and this point isn't in a saved area. Save areas for offline use from the Backpacking routes tab while online."); return; }
      setPoint(p); setTab('check'); setOfflineFrom(area); setSheet(s => (s === 'min' ? 'half' : s)); setRaw(offlineRaw(area.offline, p, zoom)); setLoading(false);
      return;
    }
    setPoint(p); setLoading(true); setTab('check'); setOfflineFrom(null); setSheet(s => (s === 'min' ? 'half' : s));
    const data = await fetchPoint(p, zoom);
    if (id !== latest.current) return;
    setRaw(data); setLoading(false);
  }, []);

  const onMapClick = useCallback((p: LatLng, zoom: number) => { if (tab === 'check') checkPoint(p, zoom); }, [tab, checkPoint]);
  const onCheckWater = useCallback((w: WaterAccess) => {
    setWater(w.kind === 'lake' ? 'lake' : 'stream');
    checkPoint({ lat: w.at[1], lng: w.at[0] }, 15);
  }, [checkPoint]);

  const onSearchRoutes = useCallback(async () => {
    const v = view.current;
    if (!v) return;
    const bbox = clipToCalifornia(v.bbox); // only search the part of the view that's in California
    if (!bbox) { setRoutesError('The map view is outside California. Pan to California to search for routes.'); return; }
    const tooBig = checkSearchArea(bbox);
    if (tooBig) { setRoutesError(tooBig); return; }
    setRoutesError(null); setRoutesLoading(true); setSelectedRoute(null); setSheet(s => (s === 'min' ? 'half' : s));
    try {
      const data = await searchArea(bbox);
      setRouteData(data);
      if (pendingRoute.current) {
        const id = pendingRoute.current;
        pendingRoute.current = null;
        if (data.near.some(n => n.trail.id === id)) setSelectedRoute(id);
        else setRoutesError("The shared route isn't in this map view's search. Try zooming out and searching again.");
      }
    }
    catch (e) { setRoutesError(`Search failed: ${(e as Error).message}`); }
    finally { setRoutesLoading(false); }
  }, []);

  // Save the current map view (route data, land, regulations and basemap tiles) for offline use.
  const onSaveArea = useCallback(async (name: string) => {
    const v = view.current;
    const bbox = v && clipToCalifornia(v.bbox);
    if (!bbox) { setRoutesError('Pan to California to save an area.'); return; }
    const tooBig = checkSearchArea(bbox);
    if (tooBig) { setRoutesError(tooBig); return; }
    setRoutesError(null);
    try {
      setSaving({ phase: 'Downloading trails, land and regulations', done: 0, total: 0 });
      const { prepared, offline } = await fetchAreaForOffline(bbox);
      const { urls, zMax } = tileUrls(bbox);
      setSaving({ phase: `Downloading basemap tiles (zoom 8–${zMax})`, done: 0, total: urls.length });
      const tileBytes = await cacheTiles(urls, (done, total) => setSaving(s => s && { ...s, done, total }));
      await navigator.storage?.persist?.(); // ask the browser not to evict saved areas under storage pressure
      await putArea({ id: crypto.randomUUID(), name: name.trim() || 'Saved area', bbox, savedAt: new Date().toISOString(), prepared, offline, tiles: urls, tileBytes });
      setRouteData(prepared);
      refreshAreas();
    } catch (e) {
      setRoutesError(`Saving failed: ${(e as Error).message}`);
    } finally { setSaving(null); }
  }, [refreshAreas]);

  const onLoadArea = useCallback((a: SavedArea) => {
    setRouteData(a.prepared); setSelectedRoute(null); setRoutesError(null);
    setFlyTarget({ lat: (a.bbox.south + a.bbox.north) / 2, lng: (a.bbox.west + a.bbox.east) / 2 });
  }, []);

  const onDeleteArea = useCallback(async (a: SavedArea) => {
    const keep = new Set(areasRef.current.filter(x => x.id !== a.id).flatMap(x => x.tiles)); // tiles shared with other areas stay
    await uncacheTiles(a.tiles, keep).catch(() => {});
    await deleteArea(a.id);
    refreshAreas();
  }, [refreshAreas]);

  // Opening a shared link: re-run its point check, and its route search once the map reports its view.
  const restored = useRef(false);
  const onView = useCallback((bbox: BBox, zoom: number) => {
    view.current = { bbox, zoom };
    setMapView({ lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2, zoom });
    if (restored.current) return;
    restored.current = true;
    if (shared.point) checkPoint(shared.point, zoom).then(() => { if (shared.tab === 'routes') setTab('routes'); });
    if (shared.tab === 'routes' && (shared.route || shared.filters)) onSearchRoutes();
  }, [checkPoint, onSearchRoutes]);

  // Keep the URL in sync so it can be copied and shared at any time (replaceState: no history spam).
  useEffect(() => {
    const t = setTimeout(() => {
      const hash = encodeState({ map: mapView ?? undefined, tab, point: point ?? undefined, water, overlays: visible, mapLand,
        filters: routeData || tab === 'routes' ? filters : undefined, route: selectedRoute ?? undefined },
      { filters: DEFAULT_FILTERS, overlays: defaultVisible });
      if (hash !== window.location.hash.slice(1)) window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname);
    }, 300);
    return () => clearTimeout(t);
  }, [mapView, tab, point, water, visible, mapLand, filters, routeData, selectedRoute]);

  // A different link pasted into this tab: start from it. (Our own replaceState updates don't fire hashchange.)
  useEffect(() => {
    const onHash = () => window.location.reload();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Filters re-apply instantly to the data already downloaded for the searched area.
  const routes = useMemo(() => (routeData ? filterRoutes(routeData, filters) : null), [routeData, filters]);

  // Re-interpret instantly when the water type changes; no refetch needed.
  const result = useMemo(() => (point && raw ? interpret(point, water, raw) : null), [point, raw, water]);

  return (
    <div id="app">
      <Sidebar tab={tab} onTab={setTab}
        sheet={sheet} onSheet={setSheet}
        water={water} onWater={setWater} onFly={setFlyTarget} loading={loading} result={result} notice={notice}
        online={online} offlineFrom={offlineFrom} near={mapView ?? undefined}
        routes={{ filters, onFilters: setFilters, onSearch: onSearchRoutes, loading: routesLoading, error: routesError,
          result: routes, selectedId: selectedRoute, onSelect: setSelectedRoute, onCheckWater,
          offline: { online, areas, saving, onSave: onSaveArea, onLoad: onLoadArea, onDelete: onDeleteArea } }}
        shore={{ filters: shoreFilters, onFilters: setShoreFilters, onSearch: onSearchShore, loading: shoreLoading, error: shoreError,
          spots: shoreSpots, total: shoreResult?.spots.length ?? 0, errors: shoreResult?.errors ?? [], selectedId: selectedSpot, onSelect: setSelectedSpot,
          onCheck: (s: ShoreSpot) => { setWater('ocean'); checkPoint({ lat: s.rockAt[1], lng: s.rockAt[0] }, 16); } }} />
      <div id="mapwrap">
      <ErrorBoundary name="map">
      <MapView basemap={basemap} visible={visible} mapLand={mapLand} marker={point} flyTarget={flyTarget} onClick={onMapClick}
        initialView={shared.map} onView={onView}
        routes={tab === 'routes' ? routes?.routes ?? [] : []} selectedRoute={selectedRoute}
        onSelectRoute={setSelectedRoute} onCheckWater={onCheckWater}
        shore={tab === 'shore' ? { result: shoreResult, spots: shoreSpots ?? [], selectedId: selectedSpot, onSelect: setSelectedSpot } : null} />
      </ErrorBoundary>
      <MapLayers basemap={basemap} onBasemap={setBasemap} visible={visible} onToggle={id => setVisible(v => ({ ...v, [id]: !v[id] }))}
        mapLand={mapLand} onMapLand={setMapLand} />
      </div>
      <DisclaimerGate />
    </div>
  );
}
