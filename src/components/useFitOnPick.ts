import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type L from 'leaflet';

// Fit the map to a picked route or spot once, when it's picked. Not again when it reappears (switching back to its
// tab, or a filter change re-creating the results): the user may have moved the map since, and keeps that view.
export function useFitOnPick(id: string | null, bounds: () => L.LatLngBounds | null, options: L.FitBoundsOptions) {
  const map = useMap();
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!id) { fitted.current = null; return; }
    if (fitted.current === id) return;
    const b = bounds();
    if (!b) return; // not shown right now (another tab): fit once it is
    fitted.current = id;
    map.fitBounds(b, options);
  });
}
