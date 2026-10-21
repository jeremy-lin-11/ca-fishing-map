import type { ReactNode } from 'react';
import { CONFIG } from '../config';
import MoreFilters from './MoreFilters';
import { useReveal } from './useReveal';
import { DEFAULT_SHORE_FILTERS, ROCK_LABEL, type Difficulty, type RockKind, type ShoreFilters, type ShoreSpot } from '../lib/shore';

interface Props {
  filters: ShoreFilters;
  onFilters: (f: ShoreFilters) => void;
  onSearch: () => void;
  loading: boolean;
  error: string | null;
  spots: ShoreSpot[] | null;
  total: number;
  errors: string[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCheck: (s: ShoreSpot) => void;
}

const MORE = ['includeTrails', 'parking', 'wheelchair', 'showNoTake', 'hideClosed'] as const;

const DIFF: Record<Difficulty, { label: string; badge: string }> = {
  easy: { label: 'Easy', badge: 'ok' }, moderate: { label: 'Moderate', badge: 'warn' }, hard: { label: 'Hard', badge: 'no' }
};
const Ext = ({ href, children }: { href: string; children: ReactNode }) => <a target="_blank" rel="noopener" href={href}>{children}</a>;

// Shore-angler rockfish rules, quoted from CDFW's Groundfish Summary (updated June 23, 2026). Seasons and limits
// change in-season, so this always links to the live page. Update the date and text when CDFW changes them.
function RockfishRules() {
  return (
    <div className="card">
      <h3>Rockfish from shore: CDFW rules</h3>
      <ul>
        <li><b>No season or depth limits from shore.</b> Shore-based anglers (beaches, banks, piers, jetties, breakwaters,
          docks) are exempt from the season and depth restrictions on rockfish, cabezon, greenlings and other federally
          managed groundfish (Title 14 §27.20(b)(1)(C)–(D)). No boat or watercraft may assist.</li>
        <li><b>Bag limit:</b> 10 rockfish, cabezon and greenlings in combination; copper rockfish 1; vermilion/sunset 4 in
          the Northern area, 2 elsewhere; canary 2. Some species (e.g. yelloweye, cowcod) may not be kept at all.</li>
        <li>MPAs still apply: no-take reserves are hidden below unless you show them.</li>
      </ul>
      <p className="hint">As of CDFW's Groundfish Summary updated June 23, 2026; regulations can change in-season.{' '}
        <Ext href={CONFIG.shore.groundfishSummary}>Check the current rules</Ext>.</p>
    </div>
  );
}

function Spot({ s, selected, onSelect, onCheck }: { s: ShoreSpot; selected: boolean; onSelect: () => void; onCheck: () => void }) {
  const hab = (Object.entries(s.habitat.meters) as [RockKind, number][]).sort((a, b) => b[1] - a[1])
    .map(([k, m]) => `${m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'} ${ROCK_LABEL[k]}`).join(', ');
  const f = s.features;
  const access = [f.stairs && 'stairs to water', f.path && 'path to water', f.blufftopTrail && 'blufftop trail', f.parking && 'parking',
    f.fee && 'fee', f.wheelchair && 'wheelchair access', f.restrooms && 'restrooms', f.tidepools && 'tidepools', f.fishing && 'listed for fishing']
    .filter(Boolean).join(' · ');
  return (
    <div className={`card route${selected ? ' selected' : ''}`}>
      <button type="button" className="routehead" onClick={onSelect}>
        <b>{s.name}</b>
        <span className={`badge ${DIFF[s.difficulty].badge}`}>{DIFF[s.difficulty].label}</span>
      </button>
      <div className="hint">{s.source === 'access point' ? 'Coastal Commission access point' : 'Trail access'} · {hab || 'rocky shoreline nearby'}</div>
      {selected && <>
        <ul>
          <li><b>Getting down:</b> {s.difficultyWhy}. Rock is {Math.round(s.rockMeters)} m from the access point.</li>
          {access && <li><b>Access:</b> {access}</li>}
          {s.closed && <li className="err">Access point closure: {s.closed}</li>}
          <li><b>Land:</b> {s.publicLand ?? 'unknown'}</li>
          <li><b>MPA:</b> {s.mpa ? <>{s.mpa.name} ({s.mpa.type}): {s.mpa.text}{s.mpa.allowed && <> <i>{s.mpa.allowed}</i></>}</> : 'none at the rocks'}</li>
          <li><b>Groundfish management area:</b> {s.groundfishArea}</li>
          {s.description && <li className="hint">{s.description}</li>}
        </ul>
        <div className="row">
          <button type="button" className="linkbtn" onClick={onCheck}>Full fishing check here</button>
          {s.directionsUrl && <Ext href={s.directionsUrl}>Directions</Ext>}
        </div>
      </>}
    </div>
  );
}

export default function ShorePanel({ filters: f, onFilters, onSearch, loading, error, spots, total, errors, selectedId, onSelect, onCheck }: Props) {
  const set = <K extends keyof ShoreFilters>(k: K, v: ShoreFilters[K]) => onFilters({ ...f, [k]: v });
  const changed = MORE.filter(k => f[k] !== DEFAULT_SHORE_FILTERS[k]).length;
  const reset = () => onFilters({ ...f, ...Object.fromEntries(MORE.map(k => [k, DEFAULT_SHORE_FILTERS[k]])) });
  const results = useReveal(loading, error);
  const toggleDiff = (d: Difficulty) => set('difficulty', f.difficulty.includes(d) ? f.difficulty.filter(x => x !== d) : [...f.difficulty, d]);
  return (
    <section>
      <p className="err safety"><b>Safety:</b> sneaker waves, slick rock and crumbling bluffs injure and kill shore anglers in California
        every year. Never turn your back on the ocean, check tides and surf, wear grippy footwear, and fish hard spots with a partner.
        "Hard" means a high or sheer climb or no mapped path down.</p>
      <form className="routeform" onSubmit={e => { e.preventDefault(); onSearch(); }}>
        <p className="hint">Finds rocky shoreline near public coastal access or public-land trails in the current map view.</p>
        <div className="field"><span>Access difficulty</span>
          <div className="row">{(['easy', 'moderate', 'hard'] as Difficulty[]).map(d => (
            <label key={d}><input type="checkbox" checked={f.difficulty.includes(d)} onChange={() => toggleDiff(d)} /> {DIFF[d].label}</label>))}</div>
        </div>
        <MoreFilters changed={changed} onReset={reset}>
        <label><input type="checkbox" checked={f.includeTrails} onChange={e => set('includeTrails', e.target.checked)} /> Include trail access (not just official access points)</label>
        <label><input type="checkbox" checked={f.parking} onChange={e => set('parking', e.target.checked)} /> Parking listed</label>
        <label><input type="checkbox" checked={f.wheelchair} onChange={e => set('wheelchair', e.target.checked)} /> Wheelchair accessible</label>
        <label><input type="checkbox" checked={f.showNoTake} onChange={e => set('showNoTake', e.target.checked)} /> Show spots in no-take MPAs (no fishing)</label>
        <label><input type="checkbox" checked={f.hideClosed} onChange={e => set('hideClosed', e.target.checked)} /> Hide closed access points</label>
        </MoreFilters>
        <label className="field"><span>Sort by</span>
          <select value={f.sort} onChange={e => set('sort', e.target.value as ShoreFilters['sort'])}>
            <option value="habitat">Most rocky habitat</option>
            <option value="easiest">Easiest access first</option>
          </select>
        </label>
        <button disabled={loading}>{loading ? 'Searching…' : spots ? 'Search this map view' : 'Find shore spots'}</button>
      </form>
      <div ref={results} className="results">
      {loading && <p className="loading">Checking shoreline, access points, MPAs and bluff heights…</p>}
      {error && <p className="err">{error}</p>}
      {spots && !loading && <>
        <h2>{spots.length} spot{spots.length === 1 ? '' : 's'} <span className="hint">({total} found)</span></h2>
        {spots.length === 0 && total > 0 && <p className="hint">All {total} spots are hidden by the filters. Check the access
          difficulties above{changed > 0 ? <>, or reset the {changed} changed filter{changed === 1 ? '' : 's'} under More filters</> : <>; spots
          in no-take MPAs are hidden unless shown under More filters</>}.</p>}
        {errors.length > 0 && <p className="err">Could not load: {errors.join(', ')}. Results may be incomplete.</p>}
        {spots.map(s => <Spot key={s.id} s={s} selected={s.id === selectedId} onSelect={() => onSelect(s.id === selectedId ? null : s.id)} onCheck={() => onCheck(s)} />)}
        <p className="disclaimer">Habitat is from CDFW shoreline mapping and bluff heights from NOAA elevation data; both can be off, and
          conditions change. Trail access means a mapped OpenStreetMap trail reaches within 150 m of the rocks on public land; it may
          end at a viewpoint. Judge the descent yourself.</p>
      </>}
      </div>
      <RockfishRules />
    </section>
  );
}
