import { useEffect, useRef, useState } from 'react';
import { OVERLAYS, type OverlayId } from '../config';
import type { AgencyKey } from '../regs';
import { ALL_LAND } from '../lib/land';
import LandTypePicker from './LandTypePicker';

export type Basemap = 'topo' | 'imagery' | 'relief';
export const BASEMAP_LABELS: Record<Basemap, string> = {
  topo: 'USGS Topo (works offline)', imagery: 'USGS Imagery', relief: 'Relief & seafloor (NOAA)'
};

function Legend() {
  return (
    <div id="legend">
      <span><i style={{ background: '#0096c7' }} />MPA</span>
      <span><i style={{ background: '#e76f00' }} />Special-regulation water</span>
      <span><i style={{ background: '#c1121f' }} />RCA depth line</span>
      <span><i style={{ border: '2px dashed #6e40c9', background: 'transparent' }} />Saved offline area</span>
    </div>
  );
}

interface Props {
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  visible: Record<OverlayId, boolean>;
  onToggle: (id: OverlayId) => void;
  mapLand: AgencyKey[];
  onMapLand: (v: AgencyKey[]) => void;
}

// Basemap and overlay picker, floating over the map's top-right corner (replaces Leaflet's layers control).
export default function MapLayers({ basemap, onBasemap, visible, onToggle, mapLand, onMapLand }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const shown = OVERLAYS.filter(o => visible[o.id]).length;

  return (
    <div className="maplayers" ref={box}>
      <button type="button" className="maplayers-btn" aria-expanded={open} aria-controls="maplayers-panel" onClick={() => setOpen(o => !o)}>
        Layers <span className="count">{shown}</span>
      </button>
      {open && (
        <div id="maplayers-panel" className="maplayers-panel">
          <h2>Basemap</h2>
          {(Object.keys(BASEMAP_LABELS) as Basemap[]).map(b => (
            <label key={b}><input type="radio" name="basemap" checked={basemap === b} onChange={() => onBasemap(b)} /> {BASEMAP_LABELS[b]}</label>
          ))}
          <h2>Overlays</h2>
          {OVERLAYS.map(o => (
            <div key={o.id}>
              <label><input type="checkbox" checked={visible[o.id]} onChange={() => onToggle(o.id)} /> {o.label}</label>
              {o.id === 'land' && visible.land && (
                <details className="sub">
                  <summary>Land types shown ({mapLand.length}/{ALL_LAND.length})</summary>
                  <LandTypePicker value={mapLand} onChange={onMapLand} />
                </details>
              )}
            </div>
          ))}
          <Legend />
        </div>
      )}
    </div>
  );
}
