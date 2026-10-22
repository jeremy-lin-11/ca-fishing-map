// "Report a problem": a short form that sends the reporter's notes plus what they were looking at (lib/report.ts).
// Location is sent only if "Include this map location" stays checked; the exact fields are shown before sending.
import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config';
import { buildReport, issueUrl, REPORT_CATEGORIES, reportText, type ReportCategory, type ReportContext } from '../lib/report';
import { sendReport } from '../posthog';

interface Props { context: () => ReportContext; onClose: () => void }

export default function ReportProblem({ context, onClose }: Props) {
  const [ctx] = useState(context); // what the reporter is looking at when the form opens
  const [category, setCategory] = useState<ReportCategory>('other');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [includeLocation, setIncludeLocation] = useState(true);
  const [state, setState] = useState<'editing' | 'sending' | 'sent' | 'failed'>('editing');
  const [copied, setCopied] = useState(false);
  const downOnBackdrop = useRef(false);
  const report = buildReport({ category, notes, email, includeLocation }, ctx);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const send = async () => {
    setState('sending');
    setState((await sendReport(report)) ? 'sent' : 'failed');
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(reportText(report)); setCopied(true); } catch { window.prompt('Copy this report:', reportText(report)); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}>
      <div className="modal report">
        <h2 id="report-title">Report a problem</h2>
        {state === 'sent' ? <>
          <p>Thanks! Your report was sent.</p>
          <button type="button" onClick={onClose}>Close</button>
        </> : <form onSubmit={e => { e.preventDefault(); if (notes.trim()) send(); }}>
          <label className="field">What's wrong?
            <select value={category} onChange={e => setCategory(e.target.value as ReportCategory)}>
              {(Object.keys(REPORT_CATEGORIES) as ReportCategory[]).map(k => <option key={k} value={k}>{REPORT_CATEGORIES[k]}</option>)}
            </select>
          </label>
          <label className="field">Details
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} maxLength={4000} required autoFocus
              placeholder="e.g. This is Stevens Creek Reservoir, but it says stream rules apply." />
          </label>
          <label className="field">Email (optional, if you'd like a reply)
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} autoComplete="email" />
          </label>
          <label className="check">
            <input type="checkbox" checked={includeLocation} onChange={e => setIncludeLocation(e.target.checked)} />
            Include this map location {ctx.point ? '(the spot you checked and the map view)' : '(the map view)'}, so the problem can be reproduced
          </label>
          <details className="sub">
            <summary>What's sent</summary>
            <pre className="report-preview">{reportText(report)}</pre>
          </details>
          {state === 'failed' && <div className="err">
            <p>Couldn't send the report (an ad blocker may block it, or you're offline). You can post it as a GitHub issue
              instead: it opens pre-filled. <b>GitHub issues are public</b>, so anyone can see it{includeLocation ? ', including the map location (uncheck it above to leave it out)' : ''}.
              Your email isn't included. You'll need a GitHub account.</p>
          </div>}
          <div className="row">
            <button type="submit" disabled={!notes.trim() || state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send report'}</button>
            {state === 'failed' && <>
              <a className="button" href={issueUrl(CONFIG.issuesUrl, report)} target="_blank" rel="noopener">Open a GitHub issue</a>
              <button type="button" onClick={copy}>{copied ? 'Copied!' : 'Copy report'}</button>
            </>}
            <button type="button" className="linkbtn" onClick={onClose}>Cancel</button>
          </div>
        </form>}
      </div>
    </div>
  );
}
