import { AGENCY_COLORS, AGENCY_LABELS, type AgencyKey } from '../regs';
import { ALL_LAND, LAND_GROUPS, PUBLIC_LAND } from '../lib/land';

// Checkbox list of land ownership types, grouped, with color swatches and quick presets.
export default function LandTypePicker({ value, onChange }: { value: AgencyKey[]; onChange: (v: AgencyKey[]) => void }) {
  const on = new Set(value);
  const toggle = (k: AgencyKey) => onChange(on.has(k) ? value.filter(x => x !== k) : ALL_LAND.filter(x => on.has(x) || x === k));
  const toggleGroup = (keys: AgencyKey[]) => {
    const all = keys.every(k => on.has(k));
    onChange(ALL_LAND.filter(x => (keys.includes(x) ? !all : on.has(x))));
  };
  return (
    <div className="landpicker">
      <div className="presets">
        <button type="button" onClick={() => onChange(ALL_LAND)}>All</button>
        <button type="button" onClick={() => onChange(PUBLIC_LAND)} title="Excludes military, tribal and nonprofit land">Public</button>
        <button type="button" onClick={() => onChange([])}>None</button>
      </div>
      {LAND_GROUPS.map(g => (
        <div key={g.label} className="landgroup">
          <label className="grouphead">
            <input type="checkbox" checked={g.keys.every(k => on.has(k))}
              ref={el => { if (el) el.indeterminate = g.keys.some(k => on.has(k)) && !g.keys.every(k => on.has(k)); }}
              onChange={() => toggleGroup(g.keys)} /> {g.label}
          </label>
          {g.keys.map(k => (
            <label key={k} className="landtype">
              <input type="checkbox" checked={on.has(k)} onChange={() => toggle(k)} />
              <i style={{ background: AGENCY_COLORS[k] }} />{AGENCY_LABELS[k]}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
