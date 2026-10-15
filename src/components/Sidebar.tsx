import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import { LINKS } from '../regs';
import type { Analysis } from '../lib/analyze';
import type { SavedArea } from '../lib/offline';
import type { LatLng, WaterSelection } from '../types';
import ResultPanel from './ResultPanel';
import PlaceSearch from './PlaceSearch';
import About, { IOSInstallTip } from './About';
import ErrorBoundary from './ErrorBoundary';
import RoutesPanel from './RoutesPanel';
import ShorePanel from './ShorePanel';

export type Tab = 'check' | 'routes' | 'shore';
// On narrow screens the sidebar is a bottom sheet over a full-screen map: just the search and tabs, half or most of the screen.
export type Sheet = 'min' | 'half' | 'full';
const SHEETS: Sheet[] = ['min', 'half', 'full'];
const SHEET_LABEL: Record<Sheet, string> = { min: 'Show panel', half: 'Expand panel', full: 'Minimize panel' };
// Keep in step with the #panel[data-sheet] heights in styles.css.
const sheetPx = (s: Sheet) => (s === 'min' ? 148 : s === 'half' ? window.innerHeight * 0.5 : window.innerHeight - 48);

// Drag the handle to resize the sheet (it snaps to the nearest size on release); tap it to step min → half → full → min.
function SheetHandle({ sheet, onSheet, panel }: { sheet: Sheet; onSheet: (s: Sheet) => void; panel: RefObject<HTMLElement | null> }) {
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const down = (e: PointerEvent) => {
    if (!panel.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: panel.current.getBoundingClientRect().height, moved: false };
    panel.current.style.transition = 'none'; // follow the finger
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) panel.current.style.height = `${Math.max(80, Math.min(window.innerHeight - 40, d.h + dy))}px`;
  };
  const up = () => {
    const d = drag.current, el = panel.current;
    drag.current = null;
    if (!d || !el) return;
    el.style.transition = '';
    if (!d.moved) { onSheet(SHEETS[(SHEETS.indexOf(sheet) + 1) % SHEETS.length]); return; }
    const h = el.getBoundingClientRect().height;
    el.style.height = ''; // hand the height back to the CSS for the snapped size
    onSheet(SHEETS.reduce((best, s) => (Math.abs(sheetPx(s) - h) < Math.abs(sheetPx(best) - h) ? s : best)));
  };
  return <button type="button" className="sheet-handle" aria-label={SHEET_LABEL[sheet]} title={SHEET_LABEL[sheet]}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><span /></button>;
}

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  notice: string | null;
  online: boolean;
  offlineFrom: SavedArea | null;
  routes: Parameters<typeof RoutesPanel>[0];
  shore: Parameters<typeof ShorePanel>[0];
  sheet: Sheet;
  onSheet: (s: Sheet) => void;
  water: WaterSelection;
  onWater: (w: WaterSelection) => void;
  onFly: (p: LatLng & { zoom?: number }) => void;
  near?: LatLng;
  loading: boolean;
  result: Analysis | null;
}


// The URL always reflects the current view, filters and selection (see lib/urlState.ts).
function CopyLink() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt('Copy this link:', window.location.href); }
  };
  return <button type="button" className="copylink" onClick={copy} title="Copy a link to this view">{copied ? 'Copied!' : 'Copy link'}</button>;
}

export default function Sidebar({ tab, onTab, notice, online, offlineFrom, near, routes, shore, sheet, onSheet, water, onWater, onFly, loading, result }: Props) {
  const panel = useRef<HTMLElement>(null);
  return (
    <aside id="panel" ref={panel} data-sheet={sheet}>
      <SheetHandle sheet={sheet} onSheet={onSheet} panel={panel} />
      <div className="titlebar">
        <h1>CA Public Land &amp; Fishing</h1>
        <CopyLink />
      </div>
      <PlaceSearch onFly={onFly} near={near} />
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'check'} className={tab === 'check' ? 'active' : ''} onClick={() => { onTab('check'); if (sheet === 'min') onSheet('half'); }}>Fishing check</button>
        <button type="button" role="tab" aria-selected={tab === 'routes'} className={tab === 'routes' ? 'active' : ''} onClick={() => { onTab('routes'); if (sheet === 'min') onSheet('half'); }}>Backpacking routes</button>
        <button type="button" role="tab" aria-selected={tab === 'shore'} className={tab === 'shore' ? 'active' : ''} onClick={() => { onTab('shore'); if (sheet === 'min') onSheet('half'); }}>Shore spots</button>
      </div>

      {tab === 'shore' ? <ErrorBoundary name="shore spots"><ShorePanel {...shore} /></ErrorBoundary>
        : tab === 'routes' ? <ErrorBoundary name="route search"><RoutesPanel {...routes} /></ErrorBoundary> : <>
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
        {!online && !offlineFrom && <p className="hint">You're offline. Fishing checks work inside saved areas.</p>}
        {offlineFrom && result && <p className="hint offline-note">Offline answer from "{offlineFrom.name}", saved {new Date(offlineFrom.savedAt).toLocaleDateString()}.
          Land owners are shown by agency; depth and place names need a connection.</p>}
        {notice && <p className="err">{notice}</p>}
        {loading ? <p className="loading">Checking land status and regulations…</p>
          : result ? <ErrorBoundary name="fishing check" key={`${result.point.lat},${result.point.lng}`}><ResultPanel r={result} /></ErrorBoundary>
          : <p className="hint">Tap or click anywhere on the map to see land status, whether fishing is legal there, and special regulations.</p>}
      </section>
      </>}
      <IOSInstallTip />
      <About />
      <p className="disclaimer">Informational only. Regulations change and many waters have special rules. Always confirm in the current{' '}
        <a target="_blank" rel="noopener" href={LINKS.inland}>CDFW Freshwater</a> /{' '}
        <a target="_blank" rel="noopener" href={LINKS.ocean}>Ocean</a> booklets before fishing.</p>
    </aside>
  );
}
