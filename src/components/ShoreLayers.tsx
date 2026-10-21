import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import type { RockKind, ShoreResult, ShoreSpot } from '../lib/shore';
import { useFitOnPick } from './useFitOnPick';

const ROCK_COLOR: Record<RockKind, string> = { platform: '#7b3f00', talus: '#9c6644', cliff: '#3d2b1f', sheltered: '#a47148', structure: '#6c757d' };
const DIFF_COLOR = { easy: '#1a7f37', moderate: '#bf8700', hard: '#cf222e' } as const;
const ll = ([lng, lat]: [number, number]) => [lat, lng] as [number, number];

export default function ShoreLayers({ result, spots, selectedId, onSelect }: { result: ShoreResult | null; spots: ShoreSpot[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const selected = spots.find(s => s.id === selectedId) ?? null;
  useFitOnPick(selectedId, () => selected && L.latLngBounds([ll(selected.at), ll(selected.rockAt)]).pad(2), { maxZoom: 17 });
  if (!result) return null;
  return <>
    {result.rock.map(r => <Polyline key={r.kind} positions={r.lines.map(l => l.map(ll))} interactive={false} pathOptions={{ color: ROCK_COLOR[r.kind], weight: 4, opacity: 0.85 }} />)}
    {selected && <Polyline positions={[ll(selected.at), ll(selected.rockAt)]} interactive={false} pathOptions={{ color: '#1f6feb', weight: 2, dashArray: '4 4' }} />}
    {spots.map(s => (
      <CircleMarker key={s.id} center={ll(s.at)} radius={s.id === selectedId ? 9 : 6}
        pathOptions={{ color: '#fff', weight: 2, fillColor: DIFF_COLOR[s.difficulty], fillOpacity: 1 }}
        eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelect(s.id); } }}>
        <Tooltip>{s.name}: {s.difficulty}{s.bluffM !== null ? `, ~${Math.round(s.bluffM)} m bluff` : ''}</Tooltip>
      </CircleMarker>
    ))}
  </>;
}
