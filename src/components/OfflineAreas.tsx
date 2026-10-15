import { useState } from 'react';
import type { SavedArea } from '../lib/offline';

export interface OfflineProps {
  online: boolean;
  areas: SavedArea[];
  saving: { phase: string; done: number; total: number } | null;
  onSave: (name: string) => void;
  onLoad: (a: SavedArea) => void;
  onDelete: (a: SavedArea) => void;
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Save the current view for use with no signal; load or delete saved areas.
export default function OfflineAreas({ online, areas, saving, onSave, onLoad, onDelete }: OfflineProps) {
  const [name, setName] = useState('');
  return (
    <div className="card offline">
      <h3>Offline areas <span className={`badge ${online ? 'ok' : 'warn'}`}>{online ? 'Online' : 'Offline'}</span></h3>
      {online ? (
        <form className="row" onSubmit={e => { e.preventDefault(); onSave(name); setName(''); }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Mammoth Lakes trip)" disabled={!!saving} />
          <button disabled={!!saving}>Save this map view</button>
        </form>
      ) : <p className="hint">Saving needs a connection. Saved areas below work offline: load one for route search, or click inside it for fishing checks.</p>}
      {saving && (
        <div className="progress">
          <div className="hint">{saving.phase}{saving.total ? ` ${saving.done}/${saving.total}` : '…'}</div>
          <progress max={saving.total || 1} value={saving.total ? saving.done : undefined} />
        </div>
      )}
      {areas.length > 0 && (
        <ul className="areas">
          {areas.map(a => (
            <li key={a.id}>
              <b>{a.name}</b> <span className="hint">saved {when(a.savedAt)} · {mb(a.tileBytes)} tiles · {a.prepared.near.length} trails</span>
              <div className="row">
                <button type="button" className="linkbtn" onClick={() => onLoad(a)}>Load</button>
                <button type="button" className="linkbtn" onClick={() => { if (confirm(`Delete "${a.name}" from this device?`)) onDelete(a); }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Saves route data, land ownership, CDFW regulations and USGS topo tiles (zoom 8–14) for the current view.
        Offline, fishing checks cover land, regulations, seasons and trout limits; depth and place names need a connection.
        Regulations are as of the save date.</p>
    </div>
  );
}
