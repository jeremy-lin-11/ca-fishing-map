// Everything the app knows about a clicked point. Pure data: no Leaflet, no DOM.
import { CONFIG } from '../config';
import { AGENCIES, LINKS, MPA_TYPES } from '../regs';
import type { LatLng, Note, Status, WaterSelection, WaterType } from '../types';
import { pick, queryPoint, type Attrs } from './arcgis';
import { FT_PER_M, M_PER_FATHOM, nearestRcaLines, sampleDem } from './depth';
import { classifyLands, classifyOwnership, type LandUnit } from './land';
import { buildGroups, lookupRegs, type RegGroup, type RegLookup } from './regdata';
import { districtScope, summarizeGroup, troutRule, type RegSummary, type TroutRule } from './rules';

export interface Analysis {
  point: LatLng;
  water: WaterType;
  county: string;
  lands: LandUnit[];
  landBadge: { status: Status; text: string };
  verdict: { status: Status; text: string };
  notes: Note[];
  depth: Note[];
  regs: { special: RegGroup[]; general: RegGroup[] } | null; // null for ocean
  trout: TroutRule | null;  // today's season and trout limit; null for ocean
  errors: string[];
}

// Raw service responses for a point; interpret() turns them into an Analysis.
export interface Raw {
  own: Attrs[] | null; waterBody: Attrs[] | null;
  fed: Attrs[] | null; parks: Attrs[] | null; mpa: Attrs[] | null;
  geo: any; dem: number | null; rca: Attrs[] | null; contours: Attrs[] | null; regs: RegLookup;
}

const settle = <T,>(p: Promise<T>) => p.catch(() => null);

// County at the point, shaped like the geocoder response this used to come from ({ address: { county, state } }).
// null off the coast or if the service is unavailable.
async function countyAt(p: LatLng) {
  try {
    const [c] = await queryPoint(CONFIG.counties, p, { outFields: 'NAME,STATE_NAME' });
    return c ? { address: { county: String(c.NAME), state: String(c.STATE_NAME) } } : null;
  } catch { return null; }
}

// zoom is used to size the stream search radius (~14px) so thin lines are clickable at any zoom.
export async function fetchPoint(point: LatLng, zoom: number): Promise<Raw> {
  const tol = 14 * 156543 * Math.cos(point.lat * Math.PI / 180) / Math.pow(2, zoom);
  const { layers: L, depth: D } = CONFIG;
  const salton = D.lakeContours[0];
  const [own, waterBody, fed, parks, mpa, geo, dem, rca, contours, regs] = await Promise.all([
    settle(queryPoint(L.ownership.url, point, { outFields: 'Own_Level,Own_Group,Own_Agency' })),
    settle(queryPoint(L.waterBodies.url, point, { outFields: 'NAME,FTYPE' })),
    settle(queryPoint(L.federal.url, point)),
    settle(queryPoint(L.parks.url, point, { where: L.parks.where })),
    settle(queryPoint(L.mpa.url, point)),
    countyAt(point),
    sampleDem(D.dem, point),
    settle(queryPoint(D.rca, point, { meters: 2000, outFields: 'feat_desc' })),
    settle(queryPoint(salton.url, point, { where: salton.where, meters: 400, outFields: salton.field })),
    lookupRegs(CONFIG.regs, point, tol).catch((): RegLookup => ({ hits: [], rowsByCode: new Map(), failed: ['freshwater regulations'] }))
  ]);
  return { own, waterBody, fed, parks, mpa, geo, dem, rca, contours, regs };
}

// Ownership (CAL FIRE) decides the land category; Esri federal/parks layers supply unit names when they agree.
function landUnits(own: Attrs[] | null, fed: Attrs[], parks: Attrs[]): LandUnit[] {
  const named = classifyLands([...fed, ...parks]);
  if (!own) return named; // ownership service unavailable: fall back to the federal/parks layers
  return classifyOwnership(own).map(u => {
    const match = named.find(n => n.key === u.key);
    return match && match.name !== 'Unnamed unit' ? { ...u, name: match.name } : u;
  });
}

// Today's season/trout answer from the regulation groups at the point.
function troutToday(groups: RegGroup[], kind: 'lake' | 'stream', today: Date): TroutRule {
  const sums: RegSummary[] = [];
  for (const g of groups) {
    if (g.kind.special) sums.push(summarizeGroup(g, g, 'water'));
    else if (g.code.startsWith('7.00(')) {
      const s = summarizeGroup(g, g, 'district-streams');
      const scope = districtScope(s);
      if (scope) sums.push({ ...s, scope });
    }
  }
  return troutRule(kind, sums, [today]);
}

export const analyzePoint = async (point: LatLng, zoom: number, waterSel: WaterSelection) =>
  interpret(point, waterSel, await fetchPoint(point, zoom));

export function interpret(point: LatLng, waterSel: WaterSelection, d: Raw, today = new Date()): Analysis {
  const errors: string[] = [];
  const got = (r: Attrs[] | null, name: string) => { if (!r) { errors.push(name); return []; } return r; };
  const fed = got(d.fed, 'federal lands'), parks = got(d.parks, 'parks'), mpas = got(d.mpa, 'MPA');
  if (d.regs.failed.length) errors.push(...d.regs.failed);

  if (!d.own) errors.push('land ownership');
  const lands = landUnits(d.own, fed, parks);
  const land = lands[0];
  const lake = (d.waterBody ?? []).find(w => /lake|reservoir/i.test(String(w.FTYPE ?? '')));

  // Open-coast points fall outside every CDFW inland regulation area (even the §0.01 state boundary polygon)
  // and every county. Inland, a point is a lake if it's on a mapped water body, else a stream.
  const noInlandRegs = !d.regs.failed.length && !d.regs.hits.length;
  const offshore = noInlandRegs && ((d.dem != null && d.dem < 0) || (!d.geo && !!d.own && !d.own.length));
  const water: WaterType = waterSel !== 'auto' ? waterSel : mpas.length || offshore ? 'ocean' : lake ? 'lake' : 'stream';

  let verdict: Analysis['verdict'] = { status: 'ok', text: 'Fishing legal with a CA license (check water-specific rules)' };
  const notes: Note[] = [];
  if (mpas.length) {
    const a = mpas[0];
    const type = pick(a, ['type']);
    const m = MPA_TYPES.find(t => t.match.test(type))!;
    verdict = { status: m.status, text: m.verdict };
    const url = pick(a, ['regulations_url']);
    notes.push({
      strong: pick(a, ['fullname', 'name']) || 'Marine Protected Area', text: ` (${type}): ${m.text}`,
      italic: pick(a, ['regulation_text']).trim() || undefined,
      link: /^https?:/.test(url) ? { href: url, label: 'Official text' } : undefined
    });
  } else if (land) {
    const ag = AGENCIES[land.key];
    if (ag.status === 'no') verdict = { status: 'no', text: 'Access restricted – fishing not allowed without permission' };
    else if (ag.status === 'warn') verdict = { status: 'warn', text: 'Fishing allowed, but unit-specific rules apply' };
    notes.push({ text: ag.fishing });
  } else if (water === 'ocean') {
    notes.push({ text: 'Ocean and tidal waters below the mean high tide line are public state waters. Ocean regulations apply.' });
  } else if (lake) {
    notes.push({ strong: String(lake.NAME || 'This lake'), text: ': lakebeds aren\'t ownership parcels. Navigable lakes are open to public fishing from the water (Cal. Const. art. I §25), but reach them from public land or a public access point, not across private land.' });
  } else {
    verdict = { status: 'warn', text: 'Not mapped public land – permission likely required' };
    notes.push({ text: 'No public land at this point in the data. Treat as private unless posted otherwise. Navigable waters are public, but you may not cross private land to reach them.' });
  }
  if (land && /ecological reserve|wildlife area|natural reserve/i.test(land.name + ' ' + land.type))
    notes.push({ text: 'Ecological Reserves/Wildlife Areas often have special fishing restrictions. Check CDFW Title 14 §630.' });
  if (land && /wilderness/i.test(land.name + ' ' + land.type))
    notes.push({ text: 'Wilderness: motorized access and some gear are prohibited; permits may be required.' });

  const landBadge: Analysis['landBadge'] = land
    ? (AGENCIES[land.key].public ? { status: 'ok', text: 'Public' }
      : land.key === 'NONPROFIT' ? { status: 'warn', text: 'Private conservation land' } : { status: 'no', text: 'Restricted' })
    : water === 'ocean' ? { status: 'ok', text: 'Public state waters' }
    : lake ? { status: 'ok', text: 'Public water (lake surface)' } : { status: 'warn', text: 'Not mapped / likely private' };

  let regs: Analysis['regs'] = null, trout: TroutRule | null = null;
  if (water !== 'ocean') {
    const groups = buildGroups(d.regs);
    regs = { special: groups.filter(g => g.kind.special), general: groups.filter(g => !g.kind.special) };
    trout = troutToday(groups, water === 'lake' ? 'lake' : 'stream', today);
  }

  return {
    point, water, lands, landBadge, verdict, notes, regs, trout, errors,
    county: d.geo?.address?.county || d.geo?.address?.city || '',
    depth: depthNotes(point, water, d)
  };
}

function depthNotes(point: LatLng, water: WaterType, d: Raw): Note[] {
  const v = d.dem, out: Note[] = [];
  if (water === 'ocean') {
    if (v != null && v < 0) {
      const m = -v;
      out.push({ strong: `≈ ${Math.round(m)} m`, text: ` (${Math.round(m * FT_PER_M)} ft / ${Math.round(m / M_PER_FATHOM)} fathoms)`, hint: 'NOAA NCEI DEM' });
    } else if (v != null) out.push({ text: `On land or intertidal in the NOAA elevation model (${Math.round(v)} m).` });
    else out.push({ text: 'Depth unavailable (NOAA service did not respond).' });
    if (d.rca?.length) {
      const lines = nearestRcaLines(d.rca.map(r => String(r.feat_desc)), v != null ? -v : null);
      out.push({
        text: `Nearest Rockfish Conservation Area depth line${lines.length > 1 ? 's' : ''} (within 2 km): ${lines.join('; ')}. Groundfish depth limits depend on management area and season.`,
        link: { href: LINKS.ocean, label: 'Ocean regulations' }
      });
    }
    return out;
  }
  const inBox = (b: [[number, number], [number, number]]) =>
    point.lat >= b[0][0] && point.lat <= b[1][0] && point.lng >= b[0][1] && point.lng <= b[1][1];
  const tiles = CONFIG.depth.lakeTiles.filter(lk => inBox(lk.bounds));
  tiles.forEach(lk => out.push({ strong: lk.name, text: ` bathymetric chart available. Turn on "Depth charts" (${lk.legend}; ${lk.source}).` }));

  const salton = CONFIG.depth.lakeContours[0];
  const vals = (d.contours || []).map(a => +a[salton.field]).filter(x => x > -9999).sort((a, b) => a - b);
  if (vals.length) {
    const lo = vals[0], hi = vals[vals.length - 1];
    const surfFt = v != null ? v * FT_PER_M : null;
    const deep = surfFt != null && surfFt > lo
      ? `, so roughly ${[...new Set([hi, lo].map(x => Math.round(surfFt - x)))].join('–')} ft deep at the NOAA-model surface level. The shoreline is receding, so the current depth is likely less`
      : '';
    out.push({ strong: salton.name, text: `: bottom elevation ≈ ${lo === hi ? lo : `${lo} to ${hi}`} ft (below sea level)${deep}.`, hint: salton.source });
  }
  if (!tiles.length && !vals.length)
    out.push({ text: 'No published depth survey for this water in the app\'s sources. Most California lakes and all streams lack public bathymetry.' });
  if (v != null)
    out.push({ text: `Water/ground surface elevation ≈ ${Math.round(v)} m (${Math.round(v * FT_PER_M)} ft).`, hint: 'NOAA DEM shows lake surfaces, not lake bottoms.' });
  return out;
}
