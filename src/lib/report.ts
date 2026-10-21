// Problem reports from the "Report a problem" form: what the user wrote plus what they were looking at, so a wrong
// answer can be reproduced. Location is included only when the reporter keeps "Include this map location" checked.
// Pure data (no DOM), so what gets sent is unit-tested.
import type { Analysis } from './analyze';
import type { LatLng } from '../types';

export const REPORT_CATEGORIES = {
  water: 'Wrong water type (lake / stream / ocean)',
  land: 'Wrong land owner or access',
  regs: 'Wrong or missing regulations / season / limit',
  pressure: 'Fishing pressure estimate seems off',
  app: 'Map or app problem',
  other: 'Something else'
} as const;
export type ReportCategory = keyof typeof REPORT_CATEGORIES;

export interface ReportInput { category: ReportCategory; notes: string; email: string; includeLocation: boolean }
export interface ReportContext {
  point: LatLng | null;
  view: { lat: number; lng: number; zoom: number } | null;
  link: string | null;           // reopens the view and the checked point (contains both)
  result: Analysis | null;
  waterSelection: string;
  layers: string[];              // overlays switched on
  basemap: string;
  online: boolean;
  offlineArea: string | null;    // the saved area an offline answer came from
  version: string;
  userAgent: string;
  screen: string;
}

export type Report = Record<string, string | number | boolean | null>;

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function buildReport(input: ReportInput, ctx: ReportContext): Report {
  const a = ctx.result;
  const report: Report = {
    category: input.category,
    notes: input.notes.trim().slice(0, 4000),
    email: input.email.trim().slice(0, 200) || null,
    location_shared: input.includeLocation,
    water_selection: ctx.waterSelection,
    layers: ctx.layers.join(','),
    basemap: ctx.basemap,
    online: ctx.online,
    offline_area: ctx.offlineArea ? 'yes' : null,
    version: ctx.version,
    user_agent: ctx.userAgent,
    screen: ctx.screen
  };
  if (a) Object.assign(report, {
    answer_water: a.water,
    answer_verdict: `${a.verdict.status}: ${a.verdict.text}`,
    answer_land: a.lands.map(l => `${l.name} (${l.key})`).join('; ') || a.landBadge.text,
    answer_trout: a.trout ? `${a.trout.open === true ? 'open' : a.trout.open === false ? 'closed' : 'unclear'}; ${a.trout.note} [${a.trout.source}]` : null,
    answer_special_regs: a.regs?.special.map(g => g.code).join(', ') || null,
    answer_notes: a.notes.map(n => n.strong).filter(Boolean).join('; ') || null,
    answer_pressure: a.pressure ? `${a.pressure.level} (${a.pressure.score}): ${a.pressure.reasons.map(x => x.text).join('; ')}` : null,
    answer_load_errors: a.errors.join(', ') || null
  });
  // Where: only with consent. County alone is coarse, but it's still location.
  if (input.includeLocation) Object.assign(report, {
    point_lat: ctx.point ? r5(ctx.point.lat) : null,
    point_lng: ctx.point ? r5(ctx.point.lng) : null,
    view: ctx.view ? `${r5(ctx.view.lat)},${r5(ctx.view.lng)} z${Math.round(ctx.view.zoom)}` : null,
    link: ctx.link,
    county: a?.county || null,
    offline_area: ctx.offlineArea
  });
  return report;
}

// Plain text, for copying when sending fails (e.g. an ad blocker blocks analytics).
export const reportText = (r: Report) =>
  Object.entries(r).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');

// A pre-filled GitHub "new issue" link, the fallback when sending fails. Issues are public, so the optional email
// is left out; location is in it only if the reporter kept it checked (the form warns that issues are public).
// Kept under ~7,500 characters: longer URLs fail in some browsers.
export function issueUrl(base: string, r: Report, max = 7500): string {
  const { email: _email, notes, ...rest } = r;
  const title = `Problem report: ${REPORT_CATEGORIES[r.category as ReportCategory] ?? r.category}`;
  const make = (n: string, d: string) =>
    `${base}?${new URLSearchParams({ title, body: `${n}\n\n<details><summary>What the app showed</summary>\n\n\`\`\`\n${d}\n\`\`\`\n</details>` })}`;
  let n = String(notes ?? ''), d = reportText(rest);
  // Too long: shorten the app details first, then the notes. (An encoded character is up to 9 URL characters.)
  for (let url = make(n, d); url.length > max; url = make(n, d)) {
    const drop = Math.ceil((url.length - max) / 9) + 1;
    if (d.length > 1) d = `${d.slice(0, Math.max(0, d.length - 1 - drop))}…`;
    else if (n.length) n = n.slice(0, Math.max(0, n.length - drop));
    else break;
  }
  return make(n, d);
}
