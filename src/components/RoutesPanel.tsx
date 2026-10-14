import type { ReactNode } from 'react';
import { AGENCIES } from '../regs';
import type { Route, RouteFilters, SearchResult, WaterAccess } from '../lib/trails';
import { M_PER_MILE } from '../lib/geo';
import RegsFreshness from './RegsFreshness';
import LandTypePicker from './LandTypePicker';

interface Props {
  filters: RouteFilters;
  onFilters: (f: RouteFilters) => void;
  onSearch: () => void;
  loading: boolean;
  error: string | null;
  result: SearchResult | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCheckWater: (w: WaterAccess) => void;
}

const fmtDist = (m: number) => (m < 300 ? `${Math.round(m * 3.28084)} ft` : `${(m / M_PER_MILE).toFixed(2)} mi`);
const STATUS_TEXT = { ok: 'Public, open', warn: 'Check rules/access', no: 'Closed / restricted' } as const;
const OPEN_TEXT = (open: boolean | null) => (open === true ? 'Open on your dates' : open === false ? 'Closed on your dates' : 'Season unclear');

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function WaterRow({ w, onCheck }: { w: WaterAccess; onCheck: () => void }) {
  return (
    <li>
      <button type="button" className="linkbtn" onClick={onCheck}>{w.name}</button>
      <span className="hint"> {w.kind} · {fmtDist(w.meters)} from trail</span>{' '}
      <span className={`badge ${w.status}`}>{STATUS_TEXT[w.status]}</span>
      <div className="hint">
        {w.land ? `${w.land.name}${w.land.name === AGENCIES[w.land.key].name ? '' : ` (${AGENCIES[w.land.key].name})`}` : 'Not mapped public land'}
      </div>
      <div className="hint">
        <span className={`badge ${w.trout.open === true ? 'ok' : w.trout.open === false ? 'no' : 'warn'}`}>{OPEN_TEXT(w.trout.open)}</span>{' '}
        Trout: {w.trout.note} <span className="code">{w.trout.source}</span>
      </div>
      {w.trout.caveats.map((c, i) => <div key={i} className="hint warn-text">{c}</div>)}
      {w.rules.filter(r => r.scope === 'water').map(r => (
        <div key={r.code} className="hint">
          Special regs §{r.code}: {r.closedAllYear ? 'closed to all fishing all year' : r.periods.map(p => [p.season, p.daily !== null ? `${p.daily} trout` : ''].filter(Boolean).join(', ')).join(' / ') || r.desc}
          {r.mapCode && ` (CDFW map lists §${r.mapCode})`}
          {r.unverified && ' (section unverified, check booklet)'}
        </div>
      ))}
    </li>
  );
}

function RouteItem({ r, selected, onSelect, onCheckWater }: { r: Route; selected: boolean; onSelect: () => void; onCheckWater: (w: WaterAccess) => void }) {
  return (
    <div className={`card route${selected ? ' selected' : ''}`}>
      <button type="button" className="routehead" onClick={onSelect}>
        <b>{r.name}</b>
        <span className="miles">{r.miles.toFixed(1)} mi</span>
      </button>
      <div className="hint">
        {r.manager} · {r.source === 'USFS' ? 'USFS trail' : 'OpenStreetMap'} · {r.waters.length} fishable water{r.waters.length === 1 ? '' : 's'} nearby
      </div>
      {selected && <>
        <p className="hint">{r.lengthNote}.{r.source === 'OSM' && ' Trails crossing the edge of the view may be longer.'}</p>
        <ul>{r.waters.map(w => <WaterRow key={w.id} w={w} onCheck={() => onCheckWater(w)} />)}</ul>
      </>}
    </div>
  );
}

export default function RoutesPanel({ filters: f, onFilters, onSearch, loading, error, result, selectedId, onSelect, onCheckWater }: Props) {
  const set = <K extends keyof RouteFilters>(k: K, v: RouteFilters[K]) => onFilters({ ...f, [k]: v });
  const num = (k: 'minMiles' | 'maxMiles' | 'maxWaterMeters') => (e: { target: { value: string } }) => set(k, Math.max(0, Number(e.target.value) || 0));
  return (
    <section>
      <form className="routeform" onSubmit={e => { e.preventDefault(); onSearch(); }}>
        <p className="hint">Searches trails in the current map view. Search a place or zoom to an area first. Filters update results
          instantly; press the button again after moving the map. Click a purple trail on the map to select it.</p>
        <div className="row">
          <Field label="Min miles"><input type="number" min={0} step={0.5} value={f.minMiles} onChange={num('minMiles')} /></Field>
          <Field label="Max miles"><input type="number" min={0} step={0.5} value={f.maxMiles} onChange={num('maxMiles')} /></Field>
        </div>
        <div className="row">
          <Field label="Trip start"><input type="date" value={f.tripStart} onChange={e => set('tripStart', e.target.value)} /></Field>
          <Field label="Trip end"><input type="date" value={f.tripEnd} min={f.tripStart} onChange={e => set('tripEnd', e.target.value)} /></Field>
        </div>
        <Field label="Water within">
          <select value={f.maxWaterMeters} onChange={e => set('maxWaterMeters', Number(e.target.value))}>
            <option value={100}>330 ft (100 m)</option>
            <option value={400}>¼ mile (400 m)</option>
            <option value={800}>½ mile (800 m)</option>
          </select>
        </Field>
        <Field label="Special regulations">
          <select value={f.regs} onChange={e => set('regs', e.target.value as RouteFilters['regs'])}>
            <option value="any">Any water</option>
            <option value="special">Only waters with CDFW special regs</option>
            <option value="general">Only waters under general regs</option>
          </select>
        </Field>
        <Field label="Trout">
          <select value={f.trout} onChange={e => set('trout', e.target.value as RouteFilters['trout'])}>
            <option value="any">Any</option>
            <option value="keep">Trout possession allowed every trip day (bag limit &gt; 0)</option>
            <option value="release">Catch-and-release only (0 trout)</option>
          </select>
        </Field>
        <details className="field">
          <summary>Land types for water access ({f.landTypes.length} selected)</summary>
          <LandTypePicker value={f.landTypes} onChange={v => set('landTypes', v)} />
        </details>
        <label><input type="checkbox" checked={!f.publicOnly} onChange={e => set('publicOnly', !e.target.checked)} /> Include water on unmapped (likely private) land</label>
        <label><input type="checkbox" checked={f.excludeClosed} onChange={e => set('excludeClosed', e.target.checked)} /> Exclude waters closed on my dates</label>
        <label><input type="checkbox" checked={f.hikerOnly} onChange={e => set('hikerOnly', e.target.checked)} /> Non-motorized trails only</label>
        <Field label="Sort by">
          <select value={f.sort} onChange={e => set('sort', e.target.value as RouteFilters['sort'])}>
            <option value="length">Trail length</option>
            <option value="waters">Most fishable waters</option>
          </select>
        </Field>
        <button disabled={loading}>{loading ? 'Searching…' : result ? 'Search this map view' : 'Find routes'}</button>
      </form>

      {loading && <p className="loading">Fetching trails, lakes, streams, land and regulations…</p>}
      {error && <p className="err">{error}</p>}
      {result && !loading && <>
        <h2>{result.routes.length} route{result.routes.length === 1 ? '' : 's'} <span className="hint">({result.considered} trails checked)</span></h2>
        {result.errors.length > 0 && <p className="err">Could not load: {result.errors.join(', ')}. Results may be incomplete.</p>}
        {result.notes.map((n, i) => <p key={i} className="hint">{n}</p>)}
        <RegsFreshness />
        {result.routes.map(r => (
          <RouteItem key={r.id} r={r} selected={r.id === selectedId} onSelect={() => onSelect(r.id === selectedId ? null : r.id)} onCheckWater={onCheckWater} />
        ))}
        <p className="disclaimer">Lengths are single trails, one way, not full loops or trip plans. Seasons and trout limits are evaluated
          for each trip day from the water's CDFW special regulation, district stream rules (§7.00), else the statewide default (§5.85).
          Whether a stream is anadromous isn't mapped, so anadromous-water rules show as warnings. Check trailhead access, wilderness
          permits, closures and the full regulation text (tap a water) before you go.</p>
      </>}
    </section>
  );
}
