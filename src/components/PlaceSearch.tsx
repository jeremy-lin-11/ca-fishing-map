import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { loadPlaces, searchPlaces, zoomFor, type Place, type PlaceHit } from '../lib/places';
import type { LatLng } from '../types';
import { track } from '../posthog';

const KIND_LABEL = { town: 'Town', lake: 'Lake', stream: 'Stream', trail: 'Trail' } as const;

// Search towns, lakes, streams and trails from the local index (no geocoder; works offline).
export default function PlaceSearch({ onFly, near }: { onFly: (p: LatLng & { zoom: number }) => void; near?: LatLng }) {
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLFormElement>(null);

  // Load the index on first focus, not at startup.
  const ensure = () => { if (!places && !failed) loadPlaces().then(setPlaces).catch(() => setFailed(true)); };
  useEffect(() => { setHits(places ? searchPlaces(places, q, near) : []); setActive(0); }, [places, q, near]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (h: PlaceHit) => { track('place_selected', { place_kind: h.kind }); onFly({ lat: h.lat, lng: h.lng, zoom: zoomFor(h.kind) }); setQ(h.name); setOpen(false); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)); setOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <form id="search" ref={box} onSubmit={e => { e.preventDefault(); if (hits[active]) choose(hits[active]); }} role="search">
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => { ensure(); setOpen(true); }} onKeyDown={onKey}
        placeholder="Search a town, lake, stream or trail…" autoComplete="off" aria-label="Search places"
        aria-expanded={open && hits.length > 0} aria-controls="place-results" />
      <button>Go</button>
      {open && q.trim().length >= 2 && (
        <ul id="place-results" className="suggestions" role="listbox">
          {failed ? <li className="hint">Place search isn't available (places index missing).</li>
            : !places ? <li className="hint">Loading places…</li>
            : hits.length === 0 ? <li className="hint">No California town, lake, stream or trail matches.</li>
            : hits.map((h, i) => (
              <li key={`${h.name}-${h.lat}-${h.lng}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
                onMouseDown={e => { e.preventDefault(); choose(h); }} onMouseEnter={() => setActive(i)}>
                <b>{h.name}</b> <span className="hint">{KIND_LABEL[h.kind]}{h.near ? ` · ${h.near}` : ''}</span>
              </li>
            ))}
        </ul>
      )}
    </form>
  );
}
