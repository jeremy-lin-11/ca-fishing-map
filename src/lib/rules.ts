// Fishing rules for one water on given dates: open/closed and the trout limit, from CDFW special regulations,
// district general regulations (§7.00) and the statewide default (§5.85).
import type { RegGroup } from './regdata';
import { isOpenOn, parseSeason, type Season } from './season';

// One season period of a regulation entry ("Last Sat. in Apr. through Jul. 31 | 5 trout"). Plain data (no parsed
// functions); seasons are parsed on use and cached.
export interface Period { season: string; daily: number | null; possession: number | null }

const seasonCache = new Map<string, Season | null>();
export const seasonOf = (p: Period): Season | null => {
  if (!seasonCache.has(p.season)) seasonCache.set(p.season, parseSeason(p.season));
  return seasonCache.get(p.season)!;
};

// `water`: the water's own special regulation (§7.40/§7.50, incl. "X and tributaries").
// `district-streams`: a §7.00 rule for all streams in a district ("All North Central District streams…").
// `district-anadromous`: a §7.00 rule only for anadromous waters there; whether a stream is anadromous isn't mapped.
export type RuleScope = 'water' | 'district-streams' | 'district-anadromous';

export interface RegSummary {
  code: string;
  desc: string;
  scope: RuleScope;
  closedAllYear: boolean;
  periods: Period[];
  mapCode?: string;
  unverified?: boolean;
}

// "2 trout. 4 trout in possession." -> { daily: 2, possession: 4 }; "0 trout" -> { daily: 0 }
export function parseTrout(s: string): { daily: number | null; possession: number | null } {
  const poss = s.match(/(\d+)\s*(?:hatchery\s+)?trout[^.|\d]*in\s+posses/i); // [^\d]: don't span "2 trout ... 4 trout in possession"
  const daily = s.replace(poss?.[0] ?? '\u0000', '').match(/(\d+)\s*(?:hatchery\s+)?trout/i);
  return { daily: daily ? +daily[1] : null, possession: poss ? +poss[1] : null };
}

export function summarizeGroup(g: RegGroup | undefined, base: { code: string; desc: string; mapCode?: string; unverified?: boolean }, scope: RuleScope): RegSummary {
  const periods: Period[] = [];
  let text = '';
  for (const row of g?.rows ?? []) {
    if (row.type !== 'table') { text += ' ' + row.body; continue; }
    for (const seg of row.segments) {
      const season = seg.fields.find(f => /open season/i.test(f.label || ''))?.value ?? '';
      const bag = seg.fields.find(f => /bag|limit/i.test(f.label || ''))?.value ?? '';
      text += ` ${season} ${bag}`;
      if (!season && !bag) continue;
      periods.push({ season, ...parseTrout(bag) });
    }
  }
  return { ...base, scope, closedAllYear: /closed to (all )?fishing all year/i.test(text), periods };
}

// §7.00 rows: which ones are about every stream vs. only anadromous waters. Rules that say nothing about
// trout or closures (e.g. "Closed to the take of salmon") don't affect trout fishing and are dropped.
export function districtScope(s: RegSummary): RuleScope | null {
  const relevant = s.closedAllYear || s.periods.some(p => p.daily !== null || seasonOf(p)?.kind === 'closed');
  if (!relevant) return null;
  return /anadromous/i.test(s.desc) ? 'district-anadromous' : /stream|tidewater/i.test(s.desc) ? 'district-streams' : null;
}

export interface TroutRule {
  open: boolean | null;    // fishing open on every requested day (null = season text not readable)
  keep: boolean | null;    // trout may be kept on every requested day
  daily: number | null;    // most restrictive daily trout limit over the days
  possession: number | null;
  source: string;          // e.g. "§7.50(b)(21)" or "statewide §5.85(a)(1)"
  note: string;
  caveats: string[];       // e.g. anadromous-water district rules that may apply
}

const STATEWIDE_STREAM_SEASON = parseSeason('Last Sat. in Apr. through Nov. 15')!;
const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Rule for one day from one set of summaries (most restrictive wins across summaries).
function dayRule(sums: RegSummary[], d: Date): { open: boolean | null; daily: number | null; possession: number | null } {
  let open: boolean | null = true, daily: number | null = null, possession: number | null = null, anyLimit = false;
  for (const s of sums) {
    if (s.closedAllYear) return { open: false, daily: 0, possession: 0 };
    const withSeason = s.periods.filter(p => seasonOf(p));
    let o: boolean | null, chosen: Period[];
    if (withSeason.length) {
      chosen = withSeason.filter(p => isOpenOn(seasonOf(p), d));
      o = chosen.length > 0;
      if (!o && withSeason.length < s.periods.length) o = null; // an unreadable period might be the open one
    } else {
      chosen = s.periods; o = s.periods.length ? null : true; // no readable season: unknown if periods exist
    }
    if (o === false) return { open: false, daily: 0, possession: 0 };
    if (o === null) open = null;
    const lims = chosen.map(p => p.daily).filter((n): n is number => n !== null);
    if (lims.length) { const lim = Math.max(...lims); daily = daily === null ? lim : Math.min(daily, lim); anyLimit = true; }
    const ps = chosen.map(p => p.possession).filter((n): n is number => n !== null);
    if (ps.length) { const pl = Math.max(...ps); possession = possession === null ? pl : Math.min(possession, pl); }
  }
  return { open, daily: anyLimit ? daily : null, possession };
}

export function troutRule(kind: 'lake' | 'stream', sums: RegSummary[], dates: Date[]): TroutRule {
  const special = sums.filter(s => s.scope === 'water' && !s.unverified);
  const districtStreams = kind === 'stream' ? sums.filter(s => s.scope === 'district-streams') : [];
  const caveats = kind === 'stream'
    ? sums.filter(s => s.scope === 'district-anadromous').map(s => `If this stream is anadromous (reachable by salmon/steelhead from the ocean), §${s.code} applies${s.closedAllYear ? ': closed to all fishing all year' : s.periods[0] ? `: ${[s.periods[0].season, s.periods[0].daily !== null ? `${s.periods[0].daily} trout` : ''].filter(Boolean).join(', ')}` : ''}.`)
    : [];
  if (sums.some(s => s.unverified)) caveats.push('A special regulation listed for this water could not be verified against the text; check the booklet.');

  // Special regulations replace the district and statewide rules ("except those listed in the Special Regulations").
  const governing = special.length ? special : districtStreams;
  const source = governing.length ? governing.map(s => `§${s.code}`).join(', ') : kind === 'lake' ? 'statewide §5.85(a)(1)' : 'statewide §5.85(a)(2)';
  const days = dates.length ? dates : [new Date()];
  const perDay = days.map(d => {
    let r = governing.length ? dayRule(governing, d) : { open: kind === 'lake' ? true : isOpenOn(STATEWIDE_STREAM_SEASON, d), daily: 5, possession: 10 };
    // A special regulation that sets a season but no trout limit leaves the statewide limit in place.
    if (r.open !== false && r.daily === null) r = { ...r, daily: 5, possession: r.possession ?? 10 };
    // Otherwise, with no possession limit stated, possession is one daily bag (§1.17).
    if (r.possession === null) r = { ...r, possession: r.daily };
    return { d, ...r };
  });

  const closedDays = perDay.filter(r => r.open === false).map(r => r.d);
  const open: boolean | null = closedDays.length ? false : perDay.some(r => r.open === null) ? null : true;
  const openDays = perDay.filter(r => r.open !== false);
  const daily = openDays.length ? Math.min(...openDays.map(r => r.daily ?? 5)) : 0;
  const possession = openDays.length ? Math.min(...openDays.map(r => r.possession ?? 10)) : 0;
  const keep = open === false ? false : open === null ? null : daily > 0;
  const span = days.length === 1 ? fmt(days[0]) : `${fmt(days[0])}–${fmt(days[days.length - 1])}`;
  const note =
    sums.some(s => s.closedAllYear && governing.includes(s)) ? 'Closed to all fishing all year'
    : closedDays.length === days.length ? `Closed on ${span}`
    : closedDays.length ? `Closed on ${closedDays.length} of ${days.length} days (first: ${fmt(closedDays[0])}); ${daily} trout/day otherwise`
    : open === null ? `${daily} trout/day; season text could not be read, check the rule`
    : daily === 0 ? `Open ${span}, catch-and-release only (0 trout)`
    : `Open ${span}: ${daily} trout/day, ${possession} in possession`;
  return { open, keep, daily, possession, source, note, caveats };
}
