// Parses CDFW season text ("Sat. preceding Memorial Day through Sep. 30", "Last Sat. in Apr. through Nov. 15",
// "Nov. 16 through the Fri. preceding the last Sat. in Apr.", "All year", "Closed to all fishing all year")
// and answers "is this open on date X?". Unparseable text yields `null` (unknown), never a guess.

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

// An endpoint resolves to a calendar date in a given year.
type Endpoint = (year: number) => Date;

const M = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const WD = '(sun|mon|tue|wed|thu|fri|sat)[a-z]*\\.?';

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = new Date(year, month, 1);
    return new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7) + 7 * (n - 1));
  }
  const last = new Date(year, month + 1, 0);
  return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
}
const memorialDay = (y: number) => nthWeekday(y, 4, 1, -1); // last Monday in May
const laborDay = (y: number) => nthWeekday(y, 8, 1, 1);     // first Monday in Sep
const shift = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
// Weekday strictly before/after a date.
const weekdayBefore = (d: Date, wd: number) => shift(d, -(((d.getDay() - wd + 7) % 7) || 7));
const weekdayAfter = (d: Date, wd: number) => shift(d, ((wd - d.getDay() + 7) % 7) || 7);

// Parses one endpoint phrase; returns null if it isn't one we understand.
export function parseEndpoint(raw: string): Endpoint | null {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').replace(/^the /, '').trim();
  let m: RegExpMatchArray | null;
  // "Sep. 30", "September 15", "Feb.15", "Oct 31"
  if ((m = s.match(new RegExp(`^${M}\\s*(\\d{1,2})$`)))) {
    const mon = MONTHS[m[1]], day = +m[2];
    return y => new Date(y, mon, day);
  }
  // "last day in Feb."
  if ((m = s.match(new RegExp(`^last day (?:in|of) ${M}$`)))) {
    const mon = MONTHS[m[1]];
    return y => new Date(y, mon + 1, 0);
  }
  // "fourth Sat. in May", "last Saturday in Apr."
  if ((m = s.match(new RegExp(`^(first|second|third|fourth|last) ${WD} (?:in|of) ${M}$`)))) {
    const n = ORDINALS[m[1]], wd = WEEKDAYS[m[2]], mon = MONTHS[m[3]];
    return y => nthWeekday(y, mon, wd, n);
  }
  // "Sat. preceding Memorial Day", "Fri. preceding the last Sat. in Apr.", "Sat. following Labor Day"
  if ((m = s.match(new RegExp(`^${WD} (preceding|before|following|after) (.+)$`)))) {
    const wd = WEEKDAYS[m[1]], before = /preceding|before/.test(m[2]);
    const anchor: Endpoint | null = /^memorial( day)?$/.test(m[3]) ? memorialDay : /^labor day$/.test(m[3]) ? laborDay : parseEndpoint(m[3]);
    if (!anchor) return null;
    return y => (before ? weekdayBefore : weekdayAfter)(anchor(y), wd);
  }
  if (s === 'memorial day') return memorialDay;
  if (s === 'labor day') return laborDay;
  return null;
}

export type Season =
  | { kind: 'all-year'; days?: number[] }
  | { kind: 'closed' }
  | { kind: 'ranges'; ranges: [Endpoint, Endpoint][]; days?: number[] };

// Endpoint phrase as it appears inside season text. Uses non-capturing copies of M/WD so that the
// range regex's groups 1 and 2 are the two endpoints.
const Mn = M.replace('(', '(?:'), WDn = WD.replace('(', '(?:');
const ENDPOINT_TEXT = `(?:the\\s+)?(?:(?:first|second|third|fourth|last)\\s+(?:${WDn}|day)\\s+(?:in|of)\\s+${Mn}|${WDn}\\s+(?:preceding|before|following|after)\\s+(?:the\\s+)?(?:memorial(?: day)?|labor day|(?:first|second|third|fourth|last)\\s+${WDn}\\s+in\\s+${Mn}|${Mn}\\s*\\d{1,2})|${Mn}\\s*\\d{1,2}|memorial day|labor day)`;
// "A through B", or "A to B" (both sides must still be date phrases, so "from Parker Lake to …" can't match).
const RANGE = new RegExp(`(${ENDPOINT_TEXT})\\s*(?:,\\s*\\d{4}\\s*)?(?:through|to)\\s+(${ENDPOINT_TEXT})`, 'gi');

// "but only on Sat., Sun., Wed., legal holidays…" (also without "on") -> [6, 0, 3]
function onlyOnDays(s: string): number[] | undefined {
  const m = s.match(/\bonly (?:on )?((?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?[,\s]*(?:and\s+)?)+)/i);
  if (!m) return undefined;
  return [...m[1].toLowerCase().matchAll(/(sun|mon|tue|wed|thu|fri|sat)/g)].map(x => WEEKDAYS[x[1]]);
}

export function parseSeason(text: string | undefined): Season | null {
  if (!text) return null;
  const s = text.replace(/\s+/g, ' ').replace(/\bin in\b/gi, 'in').trim(); // "in in May" typo in CDFW text
  const days = onlyOnDays(s);
  const found = [...s.matchAll(RANGE)];
  const closure = /closed to (?:all )?fishing/i.test(s);
  if (!found.length) {
    if (closure) return { kind: 'closed' };             // "Closed to all fishing all year", "Closed to fishing all year."
    if (/\ball year\b/i.test(s)) return { kind: 'all-year', days };
    return null;                                         // e.g. "Closed to the take of salmon." says nothing about trout season
  }
  // "Closed to all fishing from Apr. 1 through …" means the range is a closure; don't invert it, just say unknown.
  if (closure) return null;
  const ranges: [Endpoint, Endpoint][] = [];
  for (const m of found) {
    const a = parseEndpoint(m[1]), b = parseEndpoint(m[2]);
    if (!a || !b) return null; // a range we can't fully read: unknown, not partially open
    ranges.push([a, b]);
  }
  return { kind: 'ranges', ranges, days };
}

const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// true/false, or null when the season text couldn't be parsed.
export function isOpenOn(season: Season | null, date: Date): boolean | null {
  if (!season) return null;
  if (season.kind === 'closed') return false;
  const d = dayOnly(date);
  if (season.days && !season.days.includes(d.getDay())) return false;
  if (season.kind === 'all-year') return true;
  const y = d.getFullYear();
  return season.ranges.some(([a, b]) => {
    const start = a(y), end = b(y);
    // Wrapping ranges ("Nov. 16 through … Apr.") are open from start to Dec 31 and Jan 1 to end.
    return start <= end ? d >= start && d <= end : d >= start || d <= end;
  });
}
