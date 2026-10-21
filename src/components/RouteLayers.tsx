import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import type { Route, WaterAccess } from '../lib/trails';
import type { Line } from '../lib/geo';
import { useFitOnPick } from './useFitOnPick';

const STATUS_COLOR = { ok: '#1a7f37', warn: '#bf8700', no: '#cf222e' } as const;
const toLatLngs = (lines: Line[]) => lines.map(l => l.map(([lng, lat]) => [lat, lng] as [number, number]));

interface Props { routes: Route[]; selectedId: string | null; onSelect: (id: string) => void; onCheckWater: (w: WaterAccess) => void }

export default function RouteLayers({ routes, selectedId, onSelect, onCheckWater }: Props) {
  const selected = routes.find(r => r.id === selectedId) ?? null;

  useFitOnPick(selectedId, () => {
    if (!selected) return null;
    const b = L.latLngBounds(toLatLngs(selected.lines).flat());
    selected.waters.forEach(w => b.extend([w.at[1], w.at[0]]));
    return b;
  }, { padding: [40, 40], maxZoom: 15 });

  return <>
    {routes.filter(r => r.id !== selectedId).map(r => (
      <Polyline key={r.id} positions={toLatLngs(r.lines)} pathOptions={{ color: '#8250df', weight: 3, opacity: 0.6 }}
        eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelect(r.id); } }}>
        <Tooltip sticky>{r.name} · {r.miles.toFixed(1)} mi</Tooltip>
      </Polyline>
    ))}
    {selected && <>
      <Polyline positions={toLatLngs(selected.lines)} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
      <Polyline positions={toLatLngs(selected.lines)} pathOptions={{ color: '#8250df', weight: 5 }}>
        <Tooltip sticky>{selected.name} · {selected.miles.toFixed(1)} mi</Tooltip>
      </Polyline>
      {selected.waters.map(w => (
        <CircleMarker key={w.id} center={[w.at[1], w.at[0]]} radius={7}
          pathOptions={{ color: '#fff', weight: 2, fillColor: STATUS_COLOR[w.status], fillOpacity: 1 }}
          eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onCheckWater(w); } }}>
          <Tooltip>{w.name}: click for fishing rules</Tooltip>
        </CircleMarker>
      ))}
    </>}
  </>;
}
