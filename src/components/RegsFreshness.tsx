import { useEffect, useState } from 'react';
import { CONFIG } from '../config';
import { regsFreshness, type Freshness } from '../lib/regdata';
import { LINKS } from '../regs';

// Where the regulation text comes from, and whether it's older than the booklet in effect today.
export default function RegsFreshness() {
  const [f, setF] = useState<Freshness | null>(null);
  useEffect(() => { regsFreshness(CONFIG.regs).then(setF).catch(() => setF(null)); }, []);
  if (!f) return <p className="hint">Source: CDFW freshwater regulation dataset. Verify in the current booklet before fishing.</p>;
  const updated = f.updated ? f.updated.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'unknown date';
  const text = f.cites.length ? `text from the ${f.cites.join(' / ')} booklet` : 'Title 14 regulation text';
  return (
    <p className={f.stale ? 'err' : 'hint'}>
      Source: CDFW regulation dataset ({text}, updated {updated}).{' '}
      {f.stale
        ? <>The current booklet is <b>{f.current}</b>, so some seasons and limits may have changed. Check the <a target="_blank" rel="noopener" href={LINKS.inland}>current regulations</a>.</>
        : <>Verify in the current ({f.current}) booklet before fishing.</>}
    </p>
  );
}
