// CDFW fish plantings on the map: one dot per stocked water, colored by when it was (or will be) planted.
// Clicks pass through to the map, so tapping a dot still runs the fishing check there.
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, Pane, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { fetchPlantSites, plantStatus, plantSummary, type PlantSite, type PlantStatus } from '../lib/plantings';

export const PLANT_COLORS: Record<PlantStatus, string> = { upcoming: '#2f9e44', recent: '#74b816', older: '#868e96' };
const RADIUS: Record<PlantStatus, number> = { upcoming: 6, recent: 5, older: 3.5 };

export default function PlantingsLayer() {
  const [sites, setSites] = useState<PlantSite[]>([]);
  useEffect(() => {
    fetchPlantSites().then(setSites, e => console.warn('Fish plantings failed', e));
  }, []);
  // SVG, not canvas: a canvas pane covers the whole map and would swallow hover on the layers below.
  const renderer = useMemo(() => L.svg({ pane: 'plantings', padding: 0.5 }), []);
  const today = new Date();
  // Most recent on top.
  const order: PlantStatus[] = ['older', 'recent', 'upcoming'];
  const shown = sites.map(s => ({ s, status: plantStatus(s, today) })).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <Pane name="plantings" style={{ zIndex: 455 }}>
      {shown.map(({ s, status }) => (
        <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={RADIUS[status]}
          pathOptions={{ renderer, color: '#fff', weight: 1, fillColor: PLANT_COLORS[status], fillOpacity: 0.95 }}>
          <Tooltip>{plantSummary(s)}</Tooltip>
        </CircleMarker>
      ))}
    </Pane>
  );
}
