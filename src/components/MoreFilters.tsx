import { useState, type ReactNode } from 'react';

// Secondary filters, collapsed by default. The summary counts filters changed from their defaults, so a hidden
// filter can't silently explain an empty result, and offers a reset. Starts open if any are changed (shared links).
export default function MoreFilters({ changed, onReset, children }: { changed: number; onReset: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(changed > 0);
  return (
    <details className="more" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>
        More filters{changed > 0 && <> <span className="count">{changed} changed</span>
          <button type="button" className="linkbtn" onClick={e => { e.preventDefault(); onReset(); }}>Reset</button></>}
      </summary>
      {children}
    </details>
  );
}
