import type { ReactNode } from 'react';
import { AGENCIES, LINKS, STATEWIDE, WATER } from '../regs';
import type { Analysis } from '../lib/analyze';
import type { ParsedRow, RegGroup } from '../lib/regdata';
import type { Note, Status } from '../types';
import RegsFreshness from './RegsFreshness';

const Badge = ({ status, text }: { status: Status; text: string }) => <span className={`badge ${status}`}>{text}</span>;
const Ext = ({ href, children }: { href: string; children: ReactNode }) => <a target="_blank" rel="noopener" href={href}>{children}</a>;

function NoteItem({ n }: { n: Note }) {
  return (
    <li>
      {n.strong && <b>{n.strong}</b>}{n.text}
      {n.italic && <> <i>{n.italic}</i></>}
      {n.link && <> <Ext href={n.link.href}>{n.link.label}</Ext></>}
      {n.hint && <> <span className="hint">{n.hint}</span></>}
    </li>
  );
}

const Card = ({ title, children }: { title: ReactNode; children: ReactNode }) =>
  <div className="card"><h3>{title}</h3>{children}</div>;
// A card that starts collapsed, for reference material below the answer.
const Fold = ({ title, children }: { title: ReactNode; children: ReactNode }) =>
  <div className="card"><details><summary>{title}</summary>{children}</details></div>;

// Icons repeat the badge colors' meaning for color-blind readers.
const ICON: Record<Status, string> = { ok: '✓', warn: '!', no: '✕' };

function troutChip(t: NonNullable<Analysis['trout']>): { status: Status; text: string } {
  if (t.open === false) return { status: 'no', text: 'Closed today' };
  if (t.open === null) return { status: 'warn', text: 'Season unclear' };
  if (t.keep === false || t.daily === 0) return { status: 'ok', text: 'Open today · catch & release' };
  if (t.daily !== null) return { status: 'ok', text: `Open today · ${t.daily} trout${t.possession !== null && t.possession !== t.daily ? ` (${t.possession} possession)` : ''}` };
  return { status: 'ok', text: 'Open today' };
}

// The answer in one glance: the verdict, then land and today's season. Details follow in the cards.
function Summary({ r }: { r: Analysis }) {
  const land = r.lands[0];
  const chips = [
    { ...r.landBadge, text: land ? `${r.landBadge.text} · ${land.name}` : r.landBadge.text },
    // A green "open" chip next to a "no fishing" verdict would read as a contradiction, so it's left to the card.
    ...(r.trout && r.verdict.status !== 'no' ? [troutChip(r.trout)] : [])
  ];
  return (
    <div className={`summary ${r.verdict.status}`} role="status">
      <div className="summary-verdict"><span className="summary-icon" aria-hidden>{ICON[r.verdict.status]}</span>{r.verdict.text}</div>
      <div className="summary-chips">
        {chips.map((c, i) => <span key={i} className={`chip ${c.status}`}><span aria-hidden>{ICON[c.status]}</span> {c.text}</span>)}
      </div>
      <div className="hint">{WATER[r.water].title}{r.county ? ` · ${r.county}` : ''}</div>
    </div>
  );
}

const PRESSURE_LABEL = { low: 'Low', moderate: 'Moderate', high: 'High' } as const;

// Only where fishing is allowed today: a crowd estimate for closed water would read as an invitation.
function PressureCard({ p }: { p: NonNullable<Analysis['pressure']> }) {
  return (
    <Card title="Estimated fishing pressure">
      <span className={`badge pressure-${p.level}`}>{PRESSURE_LABEL[p.level]}</span>
      <ul className="pressure-reasons">
        {p.reasons.map((x, i) => <li key={i}><span aria-label={x.effect > 0 ? 'more anglers' : 'fewer anglers'}>{x.effect > 0 ? '▲' : '▼'}</span> {x.text}</li>)}
      </ul>
      <p className="hint">An estimate from road access, people nearby, CDFW stocking and developed sites, not a count of anglers.
        {p.missing.length > 0 && ` Couldn't load: ${p.missing.join(', ')}.`}</p>
    </Card>
  );
}

function Row({ row }: { row: ParsedRow }) {
  if (row.type === 'text') return <li>{row.heading && <b>{row.heading} </b>}{row.body}</li>;
  return (
    <li>
      {row.segments.map((s, i) => (
        <div key={i}>
          {i > 0 && <span className="lbl">Then:</span>}
          {s.title && <div><b>{s.title}</b></div>}
          {s.fields.map((f, j) => <div key={j}>{f.label && <span className="lbl">{f.label}: </span>}{f.value}</div>)}
        </div>
      ))}
    </li>
  );
}

function Group({ g, maxRows }: { g: RegGroup; maxRows: number }) {
  const more = g.rows.length - maxRows;
  return (
    <div className="reg">
      <div className="regtitle">{g.desc || g.code} <span className="code">§{g.code}</span></div>
      {g.mapCode && <p className="hint">CDFW's map lists §{g.mapCode} for this water; showing §{g.code}, the entry whose text names it.</p>}
      {g.unverified && <p className="err">The section CDFW's map lists for this water doesn't name it in the regulation text. Verify in the booklet.</p>}
      <ul>{g.rows.slice(0, maxRows).map(r => <Row key={r.code} row={r} />)}</ul>
      {more > 0 && <p className="hint">…{more} more rows in this section – see full regulations.</p>}
    </div>
  );
}

function RegCards({ regs }: { regs: NonNullable<Analysis['regs']> }) {
  return <>
    <Card title="Special regulations for this water">
      {regs.special.length
        ? regs.special.map((g, i) => <div key={`${g.code}-${i}`}><div className="kind">{g.kind.label}</div><Group g={g} maxRows={12} /></div>)
        : <p className="hint">No water-specific listing here. District/county rules below (and the general summary) apply.</p>}
      <RegsFreshness />
    </Card>
    {regs.general.length > 0 && (
      <div className="card">
        <details>
          <summary>District, county &amp; statewide rules ({regs.general.length})</summary>
          {regs.general.map((g, i) => <Group key={`${g.code}-${i}`} g={g} maxRows={8} />)}
        </details>
      </div>
    )}
  </>;
}

export default function ResultPanel({ r }: { r: Analysis }) {
  const w = WATER[r.water];
  const ocean = r.water === 'ocean';
  return <>
    <Summary r={r} />
    <Card title="Public land?">
      <Badge {...r.landBadge} />
      {r.lands.length > 0 && (
        <ul>{r.lands.map((l, i) => (
          <li key={i}><b>{l.name}</b>{l.name === AGENCIES[l.key].name ? '' : ` – ${AGENCIES[l.key].name}`}</li>
        ))}</ul>
      )}
    </Card>
    <Card title="Is fishing legal here?">
      <Badge {...r.verdict} />
      <ul>{r.notes.map((n, i) => <NoteItem key={i} n={n} />)}</ul>
    </Card>
    {r.trout && (
      <Card title={`Season & trout today (${r.water === 'lake' ? 'lake' : 'stream'} rules)`}>
        <Badge status={r.trout.open === true ? 'ok' : r.trout.open === false ? 'no' : 'warn'}
          text={r.trout.open === true ? 'Open today' : r.trout.open === false ? 'Closed today' : 'Season unclear'} />
        <ul>
          <li>{r.trout.note} <span className="code">{r.trout.source}</span></li>
          {r.trout.caveats.map((c, i) => <li key={i} className="warn-text">{c}</li>)}
        </ul>
        <p className="hint">Change "Water type" above if this point is a {r.water === 'lake' ? 'stream' : 'lake'}; lakes and streams have different seasons.</p>
      </Card>
    )}
    {r.pressure && r.verdict.status !== 'no' && r.trout?.open !== false && <PressureCard p={r.pressure} />}
    <Fold title="Depth"><ul>{r.depth.map((n, i) => <NoteItem key={i} n={n} />)}</ul></Fold>
    {r.regs && <RegCards regs={r.regs} />}
    <Fold title={`${w.title} – general summary${r.county ? ` – ${r.county}` : ''}`}>
      <ul>{w.rules.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <p className="hint"><Ext href={ocean ? LINKS.ocean : LINKS.inland}>Full {ocean ? 'ocean' : 'freshwater'} regulations</Ext></p>
    </Fold>
    <Fold title="Statewide rules">
      <ul>{STATEWIDE.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <p className="hint"><Ext href={LINKS.license}>Buy a license</Ext></p>
    </Fold>
    <p className="hint">{r.point.lat.toFixed(5)}, {r.point.lng.toFixed(5)}</p>
    {r.errors.length > 0 && <p className="err">Couldn't load: {r.errors.join(', ')}. Parts of this answer may be missing; try again in a moment.</p>}
  </>;
}
