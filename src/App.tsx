import { useCallback, useMemo, useRef, useState } from 'react';
import { OVERLAYS, type OverlayId } from './config';
import { fetchPoint, interpret, type Raw } from './lib/analyze';
import { clipToCalifornia, inCalifornia } from './lib/california';
import { checkSearchArea, DEFAULT_FILTERS, filterRoutes, type Prepared, type RouteFilters, type WaterAccess } from './lib/trails';
import { searchArea } from './lib/routeSearch';
import type { BBox } from './lib/geo';
import type { LatLng, WaterSelection } from './types';
import MapView from './components/MapView';
import Sidebar, { type Tab } from './components/Sidebar';
import { ALL_LAND } from './lib/land';
import type { AgencyKey } from './regs';

const initialVisible = Object.fromEntries(OVERLAYS.map(o => [o.id, o.defaultOn])) as Record<OverlayId, boolean>;

export default function App() {
  const [tab, setTab] = useState<Tab>('check');
  const [visible, setVisible] = useState(initialVisible);
  const [mapLand, setMapLand] = useState<AgencyKey[]>(ALL_LAND);
  const [water, setWater] = useState<WaterSelection>('auto');
  const [point, setPoint] = useState<LatLng | null>(null);
  const [raw, setRaw] = useState<Raw | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<LatLng | null>(null);
  const latest = useRef(0);
  const view = useRef<{ bbox: BBox; zoom: number } | null>(null);

  const [filters, setFilters] = useState<RouteFilters>(DEFAULT_FILTERS);
  const [routeData, setRouteData] = useState<Prepared | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  const checkPoint = useCallback(async (p: LatLng, zoom: number) => {
    if (!inCalifornia(p)) { setNotice('That point is outside California. This map only covers California and its coastal waters.'); return; }
    const id = ++latest.current; // ignore responses from older clicks
    setNotice(null); setPoint(p); setLoading(true); setTab('check');
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
    setRoutesError(null); setRoutesLoading(true); setSelectedRoute(null);
    try { setRouteData(await searchArea(bbox)); }
    catch (e) { setRoutesError(`Search failed: ${(e as Error).message}`); }
    finally { setRoutesLoading(false); }
  }, []);

  // Filters re-apply instantly to the data already downloaded for the searched area.
  const routes = useMemo(() => (routeData ? filterRoutes(routeData, filters) : null), [routeData, filters]);

  // Re-interpret instantly when the water type changes; no refetch needed.
  const result = useMemo(() => (point && raw ? interpret(point, water, raw) : null), [point, raw, water]);

  return (
    <div id="app">
      <Sidebar tab={tab} onTab={setTab}
        visible={visible} onToggle={id => setVisible(v => ({ ...v, [id]: !v[id] }))} mapLand={mapLand} onMapLand={setMapLand}
        water={water} onWater={setWater} onFly={setFlyTarget} loading={loading} result={result} notice={notice}
        routes={{ filters, onFilters: setFilters, onSearch: onSearchRoutes, loading: routesLoading, error: routesError,
          result: routes, selectedId: selectedRoute, onSelect: setSelectedRoute, onCheckWater }} />
      <MapView visible={visible} mapLand={mapLand} marker={point} flyTarget={flyTarget} onClick={onMapClick}
        onView={(bbox, zoom) => { view.current = { bbox, zoom }; }}
        routes={tab === 'routes' ? routes?.routes ?? [] : []} selectedRoute={selectedRoute}
        onSelectRoute={setSelectedRoute} onCheckWater={onCheckWater} />
    </div>
  );
}
