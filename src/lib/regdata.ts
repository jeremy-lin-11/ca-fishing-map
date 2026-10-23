// Live lookup of CDFW inland (freshwater) special regulations.
//
// CDFW publishes its regulations data as one ArcGIS service (RFRService, Title 14 CCR text):
//   - a stream line layer and a polygon layer (lakes, tributary areas, districts/counties by `category`) whose
//     `reg_definition` lists the Title 14 sections that apply (comma-separated)
//   - table `regulations` holds the regulation text, keyed by `Code` / `ParentCode`
// We intersect the clicked point with the map layers, then pull every table row at or under
// those section numbers (plus ancestors). Rows are kept as { code, parentCode, verbatim }, the field names of the
// older regLinkFishing dataset, so offline areas saved from it still read.
import { arcQuery, queryPoint, type Attrs } from './arcgis';
import { http } from './http';
import type { LatLng } from '../types';

export interface RegsConfig { url: string; layers: Record<'lines' | 'polygons' | 'table', number> }

export const KINDS = [
  { key: 'lakes', label: 'Lake / reservoir', special: true },
  { key: 'streams', label: 'Stream / river', special: true },
  { key: 'tributary', label: 'Tributary area', special: true },
  { key: 'districts', label: 'District / county', special: false }
] as const;
export type Kind = (typeof KINDS)[number];
export type KindKey = Kind['key'];

// Polygon `category` -> kind (the line layer is all streams). Unknown categories count as districts, whose rules are
// shown but never decide the trout season.
const CATEGORY: Record<string, KindKey> = { freshWaterBody: 'lakes', tributaryArea: 'tributary', region: 'districts' };
export const polygonKind = (category: unknown): KindKey => CATEGORY[String(category)] ?? 'districts';
export const kindByKey = (key: KindKey) => KINDS.find(k => k.key === key)!;
export const POLYGON_CATEGORY = Object.fromEntries(Object.entries(CATEGORY).map(([c, k]) => [k, c])) as Partial<Record<KindKey, string>>;

// "4.10, 4.10(a), 7.40\n(b)(3)" -> ["4.10", "4.10(a)", "7.40(b)(3)"]
export const mapCodes = (s: unknown): string[] => [...new Set(String(s ?? '').replace(/\s+/g, '').split(',').filter(Boolean))];
export const featDesc = (s: unknown) => String(s || '').replace(/\[[a-z]\]/g, '').trim();

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

// "7.50(b)(21)" -> ["7.50(b)", "7.50"]. Below the lettered level CDFW writes subsections without parentheses:
// "7.40(b)(50)(E)2.a" -> ["7.40(b)(50)(E)2", "7.40(b)(50)(E)", ...].
export function ancestors(code: string): string[] {
  const out: string[] = [];
  let c = code, m: RegExpMatchArray | null;
  while (c.includes('(') && (m = c.match(/^(.+?)(?:\([^()]*\)|\.[A-Za-z0-9]+|\d+)$/))) { c = m[1]; out.push(c); }
  return out;
}
export const isUnder = (code: string, root: string) => code === root || ancestors(code).includes(root);

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
  const toHits = (rows: Attrs[], kindKey: (a: Attrs) => KindKey) =>
    rows.flatMap(a => mapCodes(a.reg_definition).map(code => ({ kind: kindByKey(kindKey(a)), desc: featDesc(a.feat_desc), code })));
  const [streams, polygons] = await Promise.all([
    queryPoint(`${cfg.url}/${cfg.layers.lines}`, point, { outFields: 'feat_desc,reg_definition', meters: tolMeters })
      .then(rows => toHits(rows, () => 'streams'), () => { failed.push('regulated streams'); return []; }),
    queryPoint(`${cfg.url}/${cfg.layers.polygons}`, point, { outFields: 'feat_desc,reg_definition,category' })
      .then(rows => toHits(rows, a => polygonKind(a.category)), () => { failed.push('regulated lakes and districts'); return []; })
  ]);
  // Lakes, streams, tributary areas, districts: the order buildGroups shows them in.
  const all = KINDS.flatMap(k => [...streams, ...polygons].filter(h => h.kind === k));
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
  return { hits: withText(hits, rowsByCode), rowsByCode, failed };
}

// The map lists some waters one level below the text: "5.15(b)(3)(A)" (one lake) where the text has one row for
// "5.15(b)(3)" (all of Alameda County's catfish lakes). Such hits are re-pointed to the parent row. Not for
// §7.40/§7.50 entries (resolveHit checks those by name) or top-level sections (a parent there is a whole chapter).
export function withText<H extends { code: string; mapCode?: string }>(hits: H[], rowsByCode: Map<string, Attrs>): H[] {
  const codes = [...rowsByCode.keys()];
  return hits.map(h => {
    if (SPECIAL_SECTION.test(h.code) || codes.some(c => isUnder(c, h.code))) return h;
    const parent = ancestors(h.code).find(a => rowsByCode.has(a) && (a.match(/\(/g) ?? []).length >= 2);
    return parent ? { ...h, code: parent, mapCode: h.mapCode ?? h.code } : h;
  });
}

// Rows of the current dataset (Code, ParentCode, Verbatim) in the older dataset's field names.
const textRow = (r: Attrs): Attrs => ({ code: String(r.Code ?? r.code ?? ''), parentCode: r.ParentCode ?? r.parentCode, verbatim: r.Verbatim ?? r.verbatim });
const live = (where: string) => `(${where}) AND (IsDeleted = 0 OR IsDeleted IS NULL)`;

// Regulation text rows at or under the given sections, plus their ancestors (which hold column headers).
export async function fetchRegRows(cfg: RegsConfig, codes: string[]): Promise<Map<string, Attrs>> {
  const roots = [...new Set(codes)];
  const anc = [...new Set(roots.flatMap(ancestors))];
  // LIKE 'X%' also matches siblings such as (E)20 for (E)2; buildGroups keeps only rows under each hit.
  const where = [...roots.map(c => `Code LIKE '${sq(c)}%'`),
    ...(anc.length ? [`Code IN (${anc.map(c => `'${sq(c)}'`).join(',')})`] : [])].join(' OR ');
  const rows = await arcQuery(`${cfg.url}/${cfg.layers.table}`, { where: live(where), outFields: 'Code,ParentCode,Verbatim' });
  return new Map(rows.map(textRow).map(r => [r.code, r]));
}

// Table rows: "[table row] a | b | c [table row] d | e" (older dataset) or "[start_row][row]a|b|c[row][row]_|d|e[row][end_row]"
// ("_" = empty cell). Text: "[header]H[subHeader]B" or "[start_header]H[end_header][start_subHeader]B[end_subHeader]".
const ROW = /\[(?:table )?row\]/;
const legacyTags = (t: string) => t.replace(/\[start_header\]/g, '[header]').replace(/\[start_subHeader\]/g, '[subHeader]')
  .replace(/\[(?:end_header|end_subHeader|startPreTab|endPreTab)\]/g, ' ');

export function parseRow(code: string, text: string, header: string[] | null): ParsedRow | null {
  if (/^\s*(?:\[start_row\])?\s*\[(?:table )?row\]/.test(text)) {
    const h = header || [];
    const chunks = text.replace(/\[(?:start|end)_row\]/g, '').split(ROW).map(s => s.trim()).filter(Boolean);
    const segments = chunks.map((chunk, n) => {
      let cells = chunk.split('|').map(s => s.trim()).map(s => (s === '_' ? '' : s));
      // Continuation rows have no water-name column; shift so labels line up.
      if (n > 0 && cells.length < h.length) cells = ['', ...cells];
      return {
        title: cells[0] || undefined,
        fields: cells.slice(1).map((value, i) => ({ label: h[i + 1], value })).filter(f => f.value)
      };
    });
    return { code, type: 'table', segments };
  }
  const clean = legacyTags(text.replace(/\[table header\].*$/s, '')).trim();
  if (!clean) return null;
  const m = clean.match(/^\[header\](.*?)\[subHeader\](.*)$/s);
  if (m) return { code, type: 'text', heading: m[1].trim(), body: m[2].trim() };
  return { code, type: 'text', body: clean.replace(/\[(?:header|subHeader)\]/g, ' ').replace(/\s+/g, ' ').trim() };
}

// The current dataset has no [table header] rows; these are the printed tables' column headings.
const COLUMNS: [RegExp, string[]][] = [
  [/^5\.00\(b\)/, ['Area or Body of Water', 'Open Season', 'Size (total length)', 'Bag Limit']],
  [/^5\.15\(b\)/, ['Body or Bodies of Water', 'Bag Limit']],
  [/^7\.00/, ['District/Water', 'Open Season and Special Restrictions', 'Daily Bag and Possession Limit']],
  [/^7\.[45]0\(b\)/, ['Body of Water', 'Open Season and Special Restrictions', 'Daily Bag and Possession Limit']]
];

// One group per hit, with its rows under it and column headers resolved.
export function buildGroups({ hits, rowsByCode }: RegLookup): RegGroup[] {
  const all = [...rowsByCode.keys()];
  const headerFor = (code: string) => {
    for (const a of [code, ...ancestors(code)]) {
      const m = String(rowsByCode.get(a)?.verbatim || '').match(/\[table header\]\s*(.*)$/s);
      if (m) return m[1].split('|').map(s => s.trim());
    }
    return COLUMNS.find(([re]) => re.test(code))?.[1] ?? null;
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
// A table row's water-name cell; for prose rows (the Klamath-Trinity section §7.40(b)(50) is written as text), the
// opening words, which name the reach ("Klamath River from Aug. 15 through Dec. 31 and Trinity River…").
const rowName = (verbatim: string) => {
  const cell = verbatim.match(/\[(?:table )?row\]\s*([^|]*)/);
  return (cell ? cell[1] : ROW.test(verbatim) ? '' : legacyTags(verbatim).replace(/\[[A-Za-z_ ]+\]/g, ' ').slice(0, 160)).trim();
};

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
  indexPromise ??= arcQuery(`${cfg.url}/${cfg.layers.table}`, { where: live("Code LIKE '7.50(b)(%' OR Code LIKE '7.40(b)(%'"), outFields: 'Code,Verbatim' })
    .then(rows => rows.map(textRow).map(r => ({ code: r.code, name: rowName(String(r.verbatim || '')) })).filter(r => r.name))
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
  for (const c of codeVariants(h.code))
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

// The map and the text write some subsections differently: map "(E)6a" / "(B)(1)" / "(50)(b)4" for text
// "(E)6.a" / "(B)1" / "(50)(B)4".
export function codeVariants(code: string): string[] {
  const dotted = code.replace(/(\d)([a-z])$/, '$1.$2');
  const plain = dotted.replace(/(\([A-Z]\))\((\d+)\)/, '$1$2');
  const upper = plain.replace(/(\(\d+\))\(([a-z])\)(?=\d)/, (_, a, b) => `${a}(${b.toUpperCase()})`);
  return [...new Set([code, dotted, plain, upper])];
}

export async function resolveHits<H extends { code: string; desc: string }>(cfg: RegsConfig, hits: H[]) {
  if (!hits.some(h => SPECIAL_SECTION.test(h.code))) return hits;
  const index = await specialIndex(cfg);
  return hits.map(h => resolveHit(h, index));
}

// --- freshness ------------------------------------------------------------------------------------
//
// CDFW freshwater booklets run Mar 1 - end of Feb (e.g. "2026-2027"). The older dataset was copied from a printed
// booklet whose page footers leak into the text ("…312021-2022 Freshwater Sport Fishing Regulations…"), which tells
// us which booklet; the current one is Title 14 text with no booklet year, so its last edit date decides: data not
// edited since before the current booklet took effect may miss that year's changes.

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
  const current = currentBooklet(today), start = +current.slice(0, 4);
  const latestStart = Math.max(...cites.map(c => +c.slice(0, 4)), -Infinity);
  const stale = cites.length ? latestStart < start : !!updated && updated < new Date(start, 2, 1);
  return { updated, cites, current, stale };
}

let freshnessPromise: Promise<Freshness> | null = null;
export function regsFreshness(cfg: RegsConfig, today = new Date()): Promise<Freshness> {
  freshnessPromise ??= (async () => {
    const table = `${cfg.url}/${cfg.layers.table}`;
    const [meta, rows] = await Promise.all([
      http(`${table}?f=json`).then(r => r.json()).catch(() => null),
      arcQuery(table, { where: live("Verbatim LIKE '%Sport Fishing Regulations%'"), outFields: 'Verbatim' }).catch(() => [])
    ]);
    const ms = meta?.editingInfo?.dataLastEditDate ?? meta?.editingInfo?.lastEditDate;
    return freshness(ms ? new Date(ms) : null, citedBooklets(rows.map(r => String(textRow(r).verbatim || ''))), today);
  })().catch(e => { freshnessPromise = null; throw e; });
  return freshnessPromise;
}
