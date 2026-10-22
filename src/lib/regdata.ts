// Live lookup of CDFW inland (freshwater) special regulations.
//
// CDFW publishes its regulations viewer data as one ArcGIS service:
//   - map layers (lakes, streams, tributary areas, districts) carry a `reg_number` (Title 14 section)
//   - table `fishingRegulations` holds the regulation text, keyed by `code` / `parentCode`
// We intersect the clicked point with the map layers, then pull every table row at or under
// those section numbers (plus ancestors, which hold the column headers).
import { arcQuery, queryPoint, type Attrs } from './arcgis';
import { http } from './http';
import type { LatLng } from '../types';

export interface RegsConfig { url: string; layers: Record<'districts' | 'lakes' | 'streams' | 'tributary' | 'table', number> }

export const KINDS = [
  { key: 'lakes', label: 'Lake / reservoir', special: true },
  { key: 'streams', label: 'Stream / river', special: true },
  { key: 'tributary', label: 'Tributary area', special: true },
  { key: 'districts', label: 'District / county', special: false }
] as const;
export type Kind = (typeof KINDS)[number];

// mapCode is set when CDFW's map layer listed a different section than the one whose text names this water.
export interface Hit { kind: Kind; desc: string; code: string; mapCode?: string; unverified?: boolean }
export interface RegLookup { hits: Hit[]; rowsByCode: Map<string, Attrs>; failed: string[] }

// A table row may pack several periods ("... 5 trout [table row] Aug. 1 ..."); each is a segment.
export interface RowSegment { title?: string; fields: { label?: string; value: string }[] }
export type ParsedRow =
  | { code: string; type: 'table'; segments: RowSegment[] }
  | { code: string; type: 'text'; heading?: string; body: string };
export interface RegGroup { kind: Kind; desc: string; code: string; rows: ParsedRow[]; mapCode?: string; unverified?: boolean }

const sq = (s: string) => s.replace(/'/g, "''");

// "7.50(b)(21)" -> ["7.50(b)", "7.50"]
export function ancestors(code: string): string[] {
  const out: string[] = [];
  let c = code, m: RegExpMatchArray | null;
  while ((m = c.match(/^(.*)\([^()]*\)$/))) { c = m[1]; out.push(c); }
  return out;
}
export const isUnder = (code: string, root: string) => code === root || code.startsWith(root + '(');

// Natural sort so (2) < (10) and (A) < (B).
export function codeCmp(a: string, b: string): number {
  const ta = a.split(/[().]+/).filter(Boolean), tb = b.split(/[().]+/).filter(Boolean);
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const na = +ta[i], nb = +tb[i];
    const c = !isNaN(na) && !isNaN(nb) ? na - nb : ta[i].localeCompare(tb[i]);
    if (c) return c;
  }
  return ta.length - tb.length;
}

// tolMeters = search radius for line features (streams).
export async function lookupRegs(cfg: RegsConfig, point: LatLng, tolMeters: number): Promise<RegLookup> {
  const failed: string[] = [];
  const perKind = await Promise.all(KINDS.map(async kind => {
    try {
      const rows = await queryPoint(`${cfg.url}/${cfg.layers[kind.key]}`, point,
        { outFields: 'feat_desc,reg_number', meters: kind.key === 'streams' ? tolMeters : undefined });
      return rows.filter(a => a.reg_number)
        .map(a => ({ kind, desc: String(a.feat_desc || '').replace(/\[[a-z]\]/g, '').trim(), code: String(a.reg_number).trim() }));
    } catch { failed.push(kind.label); return []; }
  }));
  const all = perKind.flat();
  const deduped = all.filter((h, i) => all.findIndex(x => x.kind === h.kind && x.code === h.code && x.desc === h.desc) === i);
  // If the section-number check can't run, map numbers may be wrong (~6%): flag them all rather than trust them.
  const hits = await resolveHits(cfg, deduped).catch(() => {
    failed.push('regulation section check');
    return deduped.map(h => (h.kind.special ? { ...h, unverified: true } : h));
  });

  let rowsByCode = new Map<string, Attrs>();
  if (hits.length) {
    try { rowsByCode = await fetchRegRows(cfg, hits.map(h => h.code)); }
    catch { failed.push('regulation text'); }
  }
  return { hits, rowsByCode, failed };
}

// Regulation text rows at or under the given sections, plus their ancestors (which hold column headers).
export async function fetchRegRows(cfg: RegsConfig, codes: string[]): Promise<Map<string, Attrs>> {
  const roots = [...new Set(codes)];
  const anc = [...new Set(roots.flatMap(ancestors))];
  const where = [...roots.map(c => `code='${sq(c)}' OR code LIKE '${sq(c)}(%'`),
    ...(anc.length ? [`code IN (${anc.map(c => `'${sq(c)}'`).join(',')})`] : [])].join(' OR ');
  const rows = await arcQuery(`${cfg.url}/${cfg.layers.table}`, { where, outFields: 'code,parentCode,verbatim,tags' });
  return new Map(rows.map(r => [r.code, r]));
}

export function parseRow(code: string, text: string, header: string[] | null): ParsedRow | null {
  if (/^\s*\[table row\]/.test(text)) {
    const h = header || [];
    const chunks = text.split('[table row]').map(s => s.trim()).filter(Boolean);
    const segments = chunks.map((chunk, n) => {
      let cells = chunk.split('|').map(s => s.trim());
      // Continuation rows have no water-name column; shift so labels line up.
      if (n > 0 && cells.length < h.length) cells = ['', ...cells];
      return {
        title: cells[0] || undefined,
        fields: cells.slice(1).map((value, i) => ({ label: h[i + 1], value })).filter(f => f.value)
      };
    });
    return { code, type: 'table', segments };
  }
  const clean = text.replace(/\[table header\].*$/s, '').trim();
  if (!clean) return null;
  const m = clean.match(/^\[header\](.*?)\[subHeader\](.*)$/s);
  if (m) return { code, type: 'text', heading: m[1].trim(), body: m[2].trim() };
  return { code, type: 'text', body: clean.replace(/\[header\]/, '').trim() };
}

// One group per hit, with its rows under it and column headers resolved.
export function buildGroups({ hits, rowsByCode }: RegLookup): RegGroup[] {
  const all = [...rowsByCode.keys()];
  const headerFor = (code: string) => {
    for (const a of [code, ...ancestors(code)]) {
      const m = String(rowsByCode.get(a)?.verbatim || '').match(/\[table header\]\s*(.*)$/s);
      if (m) return m[1].split('|').map(s => s.trim());
    }
    return null;
  };
  const groups = hits.map(h => ({
    kind: h.kind, desc: h.desc, code: h.code, mapCode: h.mapCode, unverified: h.unverified,
    rows: all.filter(c => isUnder(c, h.code)).sort(codeCmp)
      .map(c => parseRow(c, String(rowsByCode.get(c)!.verbatim || ''), headerFor(c)))
      .filter((r): r is ParsedRow => r !== null)
  })).filter(g => g.rows.length);
  // Specific waters first; among districts, named districts/counties before statewide-ish sections.
  const rank = (g: RegGroup) => (g.kind.special ? 0 : /county|district/i.test(g.desc) ? 1 : 2);
  return groups.sort((a, b) => rank(a) - rank(b));
}

// --- section-number check -----------------------------------------------------------------------
//
// CDFW's map layers and its regulation text are numbered independently, and ~6% of special-water
// features point at the wrong §7.40(b)/§7.50(b) entry (e.g. the "Twin Lakes (Mammoth)" polygon says
// §7.50(b)(157), which is Twelvemile Creek; Twin Lakes (Mammoth) is (158)). We check each hit's
// water name against the text and re-point it to the entry that actually names the water.

const GENERIC = new Set(['lake', 'lakes', 'reservoir', 'creek', 'river', 'and', 'the', 'of', 'fork', 'tributaries', 'tributary',
  'upstream', 'downstream', 'from', 'to', 'co', 'cos', 'main', 'stem', 'all', 'its', 'with', 'above', 'below', 'except',
  'north', 'south', 'east', 'west', 'middle', 'upper', 'lower', 'regulations', 'county', 'confluence', 'portion', 'mono', 'inyo']);
// Names are compared on 6-letter stems so "Isabelle Lake" matches "Isabella Lake".
const WATER_WORDS = new Set(['lake', 'lakes', 'reservoir', 'creek', 'river', 'and', 'the', 'of', 'co', 'cos']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
// Distinctive words; for names made only of common words ("South Lake") keep those, minus the water type.
const stems = (s: string) => {
  const w = words(s), distinct = w.filter(x => !GENERIC.has(x));
  return (distinct.length ? distinct : w.filter(x => !WATER_WORDS.has(x))).map(x => x.slice(0, 6));
};
const nameTokens = (s: string) => {
  const qual = [...s.matchAll(/\(([^)]*)\)/g)].map(m => m[1]).join(' ');
  const main = stems(s.replace(/\([^)]*\)/g, ' '));
  return { first: main[0], main: new Set(main), qual: new Set(stems(qual)) };
};
const rowName = (verbatim: string) => (verbatim.match(/\[table row\]\s*([^|]*)/)?.[1] ?? '').trim();

export function nameScore(mapDesc: string, textName: string): number {
  const a = nameTokens(mapDesc), b = nameTokens(textName);
  // The water's own leading name word must appear ("Miller Canyon Creek" is not "Murray Canyon Creek").
  if (!a.first || !b.main.has(a.first)) return 0;
  let main = 0, qual = 0;
  for (const w of a.main) if (b.main.has(w) || b.qual.has(w)) main++;
  for (const w of a.qual) if (b.main.has(w) || b.qual.has(w)) qual++;
  return main ? main * 2 + qual : 0; // the water's own name must match; qualifiers (place, county) break ties
}

const SPECIAL_SECTION = /^7\.(40|50)\(b\)/;
const sectionNumber = (code: string) => +(code.match(/^7\.\d0\(b\)\((\d+)\)/)?.[1] ?? NaN);

// Entry names of every §7.40(b)/§7.50(b) row, fetched once per session.
let indexPromise: Promise<{ code: string; name: string }[]> | null = null;
function specialIndex(cfg: RegsConfig) {
  indexPromise ??= arcQuery(`${cfg.url}/${cfg.layers.table}`, { where: "code LIKE '7.50(b)(%' OR code LIKE '7.40(b)(%'", outFields: 'code,verbatim' })
    .then(rows => rows.map(r => ({ code: String(r.code), name: rowName(String(r.verbatim || '')) })).filter(r => r.name))
    .catch(e => { indexPromise = null; throw e; });
  return indexPromise;
}

export function resolveHit<H extends { code: string; desc: string }>(h: H, index: { code: string; name: string }[]): H & { mapCode?: string; unverified?: boolean } {
  if (!SPECIAL_SECTION.test(h.code) || !h.desc) return h;
  // Sub-rows ("(118)(A) From the Forest Service boundary downstream…") don't repeat the water's name,
  // so a section's name includes its parent rows' names.
  const names = new Map<string, string[]>();
  for (const r of index) names.set(r.code, [...(names.get(r.code) ?? []), r.name]);
  const fullName = (code: string) => [code, ...ancestors(code)].flatMap(c => names.get(c) ?? []).join(' ');
  // The map writes some subsections "(E)6a" where the text has "(E)6.a".
  const dotted = h.code.replace(/(\d)([a-z])$/, '$1.$2');
  for (const c of new Set([h.code, dotted]))
    if (names.has(c) && nameScore(h.desc, fullName(c)) > 0) return c === h.code ? h : { ...h, code: c, mapCode: h.code };
  // Observed mismatches are renumbering shifts of 1-4 entries, so re-point only to a nearby top-level entry.
  // Within one section (e.g. the Klamath-Trinity subsections of §7.40(b)(50)) map and text use different
  // subsection schemes; we don't guess there.
  const n = sectionNumber(h.code), prefix = h.code.slice(0, 6);
  const best = [...names.keys()]
    .filter(c => c.startsWith(prefix) && /^7\.\d0\(b\)\(\d+\)$/.test(c))
    .map(c => ({ c, score: nameScore(h.desc, fullName(c)), dist: Math.abs(sectionNumber(c) - n) }))
    .filter(x => x.score > 0 && x.dist >= 1 && x.dist <= 4)
    .sort((x, y) => y.score - x.score || x.dist - y.dist)[0];
  if (best) return { ...h, code: best.c, mapCode: h.code };
  return { ...h, unverified: true };
}

export async function resolveHits<H extends { code: string; desc: string }>(cfg: RegsConfig, hits: H[]) {
  if (!hits.some(h => SPECIAL_SECTION.test(h.code))) return hits;
  const index = await specialIndex(cfg);
  return hits.map(h => resolveHit(h, index));
}

// --- freshness ------------------------------------------------------------------------------------
//
// The regulation text is a copy of a printed booklet. CDFW freshwater booklets run Mar 1 - end of Feb
// (e.g. "2026-2027"), and page footers leak into the text ("…312021-2022 Freshwater Sport Fishing
// Regulations…"), which tells us which booklet it was copied from.

export interface Freshness { updated: Date | null; cites: string[]; current: string; stale: boolean }

export function currentBooklet(today: Date): string {
  const start = today.getMonth() >= 2 ? today.getFullYear() : today.getFullYear() - 1; // March onward = new booklet
  return `${start}–${start + 1}`;
}

export function citedBooklets(texts: string[]): string[] {
  const years = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/(20\d\d)\s*[-–]\s*(20\d\d)\s+Freshwater Sport Fishing/g)) years.add(`${m[1]}–${m[2]}`);
  return [...years].sort();
}

export function freshness(updated: Date | null, cites: string[], today: Date): Freshness {
  const current = currentBooklet(today);
  const latestStart = Math.max(...cites.map(c => +c.slice(0, 4)), -Infinity);
  return { updated, cites, current, stale: cites.length > 0 && latestStart < +current.slice(0, 4) };
}

let freshnessPromise: Promise<Freshness> | null = null;
export function regsFreshness(cfg: RegsConfig, today = new Date()): Promise<Freshness> {
  freshnessPromise ??= (async () => {
    const table = `${cfg.url}/${cfg.layers.table}`;
    const [meta, rows] = await Promise.all([
      http(`${table}?f=json`).then(r => r.json()).catch(() => null),
      arcQuery(table, { where: "verbatim LIKE '%Sport Fishing Regulations%'", outFields: 'verbatim' }).catch(() => [])
    ]);
    const ms = meta?.editingInfo?.dataLastEditDate ?? meta?.editingInfo?.lastEditDate;
    return freshness(ms ? new Date(ms) : null, citedBooklets(rows.map(r => String(r.verbatim || ''))), today);
  })().catch(e => { freshnessPromise = null; throw e; });
  return freshnessPromise;
}
