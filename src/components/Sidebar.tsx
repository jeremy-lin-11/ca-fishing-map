import { useState, type FormEvent } from 'react';
import { CONFIG, OVERLAYS, type OverlayId } from '../config';
import { LINKS, type AgencyKey } from '../regs';
import { http } from '../lib/http';
import type { Analysis } from '../lib/analyze';
import type { LatLng, WaterSelection } from '../types';
import ResultPanel from './ResultPanel';
import RoutesPanel from './RoutesPanel';
import LandTypePicker from './LandTypePicker';
import { ALL_LAND } from '../lib/land';

export type Tab = 'check' | 'routes';

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  notice: string | null;
  routes: Parameters<typeof RoutesPanel>[0];
  visible: Record<OverlayId, boolean>;
  mapLand: AgencyKey[];
  onMapLand: (v: AgencyKey[]) => void;
  onToggle: (id: OverlayId) => void;
  water: WaterSelection;
  onWater: (w: WaterSelection) => void;
  onFly: (p: LatLng) => void;
  loading: boolean;
  result: Analysis | null;
}

function Search({ onFly }: { onFly: (p: LatLng) => void }) {
  const [q, setQ] = useState('');
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!q.trim()) return;
    const [[s, w], [n, e]] = CONFIG.bounds;
    const url = `${CONFIG.geocoder}/search?format=jsonv2&limit=1&viewbox=${w},${n},${e},${s}&bounded=1&q=${encodeURIComponent(q.trim())}`;
    const r = await http(url).then(r => r.json()).catch(() => []);
    if (r[0]) onFly({ lat: +r[0].lat, lng: +r[0].lon }); else alert('Place not found in California.');
  };
  return (
    <form id="search" onSubmit={submit}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a place (e.g. Lake Shasta)…" autoComplete="off" />
      <button>Go</button>
    </form>
  );
}

function Legend() {
  return (
    <div id="legend">
      <span><i style={{ background: '#0096c7' }} />MPA</span>
      <span><i style={{ background: '#e76f00' }} />Special-regulation water</span>
      <span><i style={{ background: '#c1121f' }} />RCA depth line</span>
    </div>
  );
}

export default function Sidebar({ tab, onTab, notice, routes, visible, mapLand, onMapLand, onToggle, water, onWater, onFly, loading, result }: Props) {
  return (
    <aside id="panel">
      <h1>CA Public Land &amp; Fishing</h1>
      <Search onFly={onFly} />
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'check'} className={tab === 'check' ? 'active' : ''} onClick={() => onTab('check')}>Fishing check</button>
        <button type="button" role="tab" aria-selected={tab === 'routes'} className={tab === 'routes' ? 'active' : ''} onClick={() => onTab('routes')}>Backpacking routes</button>
      </div>

      <section id="layers">
        <h2>Layers</h2>
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
      </section>

      {tab === 'routes' ? <RoutesPanel {...routes} /> : <>
      <section>
        <h2>Water type at clicked point</h2>
        <select value={water} onChange={e => onWater(e.target.value as WaterSelection)}>
          <option value="auto">Auto-detect</option>
          <option value="stream">Inland stream / river</option>
          <option value="lake">Lake / reservoir</option>
          <option value="ocean">Ocean / bay / tidal</option>
        </select>
      </section>

      <section id="result">
        {notice && <p className="err">{notice}</p>}
        {loading ? <p className="loading">Checking land status and regulations…</p>
          : result ? <ResultPanel r={result} />
          : <p className="hint">Click anywhere on the map to see land status, whether fishing is legal there, and special regulations.</p>}
      </section>
      </>}
      <p className="disclaimer">Informational only. Regulations change and many waters have special rules. Always confirm in the current{' '}
        <a target="_blank" rel="noopener" href={LINKS.inland}>CDFW Freshwater</a> /{' '}
        <a target="_blank" rel="noopener" href={LINKS.ocean}>Ocean</a> booklets before fishing.</p>
    </aside>
  );
}
