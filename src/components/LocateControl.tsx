// "Show my location" button under the zoom buttons: centers the map on the device's position and marks it.
// Uses GPS where there is one, so it also works with no signal (e.g. in a saved offline area).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { inCalifornia } from '../lib/california';

interface Fix { lat: number; lng: number; accuracy: number }

const ERRORS: Record<number, string> = {
  1: 'Location permission is off for this site.',
  2: "Couldn't get your location.",
  3: 'Getting your location took too long. Try again.'
};

export default function LocateControl() {
  const map = useMap();
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const control = new L.Control({ position: 'topleft' });
    control.onAdd = () => {
      const el = L.DomUtil.create('div', 'leaflet-bar leaflet-control locate');
      L.DomEvent.disableClickPropagation(el); // a click here isn't a fishing check
      return el;
    };
    control.addTo(map);
    setBox(control.getContainer() ?? null);
    return () => { control.remove(); };
  }, [map]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const locate = () => {
    if (!('geolocation' in navigator)) { setMsg("This browser can't share your location."); return; }
    setBusy(true); setMsg(null);
    navigator.geolocation.getCurrentPosition(p => {
      setBusy(false);
      const f = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      setFix(f);
      if (!inCalifornia(f)) setMsg('You appear to be outside California; this map only covers California.');
      map.setView([f.lat, f.lng], Math.max(map.getZoom(), 13));
    }, e => {
      setBusy(false);
      setMsg(ERRORS[e.code] ?? "Couldn't get your location.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  };

  return <>
    {box && createPortal(<>
      <a href="#" role="button" className={busy ? 'busy' : ''} title="Show my location" aria-label="Show my location"
        onClick={e => { e.preventDefault(); if (!busy) locate(); }}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
      </a>
      {msg && <div className="locate-msg" role="status">{msg}</div>}
    </>, box)}
    {fix && <>
      <Circle center={[fix.lat, fix.lng]} radius={fix.accuracy} interactive={false}
        pathOptions={{ color: '#0a84ff', weight: 1, fillColor: '#0a84ff', fillOpacity: 0.12 }} />
      <CircleMarker center={[fix.lat, fix.lng]} radius={6} pathOptions={{ color: '#fff', weight: 3, fillColor: '#0a84ff', fillOpacity: 1 }}>
        <Tooltip>You are here (±{Math.round(fix.accuracy)} m)</Tooltip>
      </CircleMarker>
    </>}
  </>;
}
