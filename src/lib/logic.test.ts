import { describe, expect, it } from 'vitest';
import { ancestors, buildGroups, codeCmp, KINDS, parseRow } from './regdata';
import { agencyKey, classifyLands } from './land';
import { nearestRcaLines } from './depth';
import { interpret, type Raw } from './analyze';

const HEADER = ['Body of Water', 'Open Season and Special Restrictions', 'Daily Bag and Possession Limit'];

describe('regdata', () => {
  it('walks section ancestors', () => {
    expect(ancestors('7.50(b)(21)(A)')).toEqual(['7.50(b)(21)', '7.50(b)', '7.50']);
    expect(ancestors('5.81')).toEqual([]);
  });
  it('sorts codes naturally', () => {
    expect(['7.50(b)(10)', '7.50(b)(2)', '7.50(b)(2)(B)', '7.50(b)(2)(A)'].sort(codeCmp))
      .toEqual(['7.50(b)(2)', '7.50(b)(2)(A)', '7.50(b)(2)(B)', '7.50(b)(10)']);
  });
  it('splits packed table rows into labelled segments', () => {
    const r = parseRow('x', '[table row] Crowley Lake. | Last Sat. in Apr. through Jul. 31. | 5 trout [table row] Aug. 1 through Nov. 15. | 2 trout', HEADER);
    expect(r).toEqual({ code: 'x', type: 'table', segments: [
      { title: 'Crowley Lake.', fields: [{ label: HEADER[1], value: 'Last Sat. in Apr. through Jul. 31.' }, { label: HEADER[2], value: '5 trout' }] },
      { title: undefined, fields: [{ label: HEADER[1], value: 'Aug. 1 through Nov. 15.' }, { label: HEADER[2], value: '2 trout' }] }
    ] });
  });
  it('parses header/subHeader text and drops header-only rows', () => {
    expect(parseRow('1.04', '[header]ANADROMOUS WATERS.[subHeader]Inland waters accessible to fish from the ocean.', null))
      .toEqual({ code: '1.04', type: 'text', heading: 'ANADROMOUS WATERS.', body: 'Inland waters accessible to fish from the ocean.' });
    expect(parseRow('7.00(a)', '[table header] District/Water |Open Season', null)).toBeNull();
  });
  it('groups rows under hits, resolving headers from ancestors, special waters first', () => {
    const rows = new Map(Object.entries({
      '7.50(b)': { code: '7.50(b)', verbatim: `LIST[table header] ${HEADER.join(' | ')}` },
      '7.50(b)(21)': { code: '7.50(b)(21)', verbatim: '[table row] Butt Valley Reservoir. | All year. | 2 trout.' },
      '5.15(b)(7)': { code: '5.15(b)(7)', verbatim: '[table row]Mono County |' }
    }));
    const groups = buildGroups({ failed: [], rowsByCode: rows, hits: [
      { kind: KINDS[3], desc: 'Mono County', code: '5.15(b)(7)' },
      { kind: KINDS[0], desc: 'Butt Valley Reservoir', code: '7.50(b)(21)' }] });
    expect(groups.map(g => g.code)).toEqual(['7.50(b)(21)', '5.15(b)(7)']);
    expect(groups[0].rows[0]).toMatchObject({ type: 'table', segments: [{ fields: [{ label: HEADER[1], value: 'All year.' }, { label: HEADER[2], value: '2 trout.' }] }] });
  });
});

describe('land', () => {
  it('maps agency strings', () => {
    expect(agencyKey('Bureau of Land Management')).toBe('BLM');
    expect(agencyKey('Forest Service')).toBe('USFS');
    expect(agencyKey('Department of Defense')).toBe('DOD');
    expect(agencyKey('State park or forest')).toBe('STATE');
    expect(agencyKey('County park')).toBe('LOCAL');
  });
  it('puts the most restrictive unit first', () => {
    const l = classifyLands([{ Agency: 'Bureau of Land Management', unit_name: 'BLM' }, { Agency: 'Department of Defense', unit_name: 'Fort X' }]);
    expect(l[0].key).toBe('DOD');
  });
});

describe('depth', () => {
  it('keeps the RCA lines closest to the local depth', () => {
    const lines = ['RCA - 30-fm (55-m) Contour', 'RCA - 100-fm (183-m) Contour', 'RCA - 75-fm (137-m) Contour', 'RCA - 200-fm (366-m) Contour'];
    expect(nearestRcaLines(lines, 169)).toEqual(['RCA - 100-fm (183-m) Contour', 'RCA - 75-fm (137-m) Contour']);
  });
});

describe('interpret', () => {
  const base: Raw = { own: [], waterBody: [], fed: [], parks: [], mpa: [], bay: [], nearBay: [], coastalBay: [], geo: { address: { state: 'California', county: 'Monterey County' } },
    dem: -500, rca: [], contours: [], regs: { hits: [], rowsByCode: new Map(), failed: [] } };
  const p = { lat: 36.75, lng: -122 };
  it('treats points outside all inland regulation areas and below sea level as ocean', () => {
    const a = interpret(p, 'auto', base);
    expect(a.water).toBe('ocean');
    expect(a.landBadge.text).toBe('Public state waters');
    expect(a.regs).toBeNull();
  });
  it('keeps below-sea-level inland water (e.g. Salton Sea) as freshwater', () => {
    const a = interpret(p, 'auto', { ...base, dem: -71, regs: { ...base.regs, hits: [{ kind: KINDS[0], desc: 'Salton Sea', code: '5.25' }] } });
    expect(a.water).toBe('stream');
  });
  it('honours a manual water selection', () => {
    expect(interpret(p, 'lake', base).water).toBe('lake');
  });
  const inland = { ...base, dem: 2000, regs: { ...base.regs, hits: [{ kind: KINDS[3], desc: 'Mono County', code: '5.15(b)(7)' }] } };
  it('LADWP land is public (CAL FIRE ownership)', () => {
    const a = interpret(p, 'auto', { ...inland, own: [{ Own_Level: 'City', Own_Group: 'Local Government', Own_Agency: 'Los Angeles - Department of Water and Power, City of' }] });
    expect(a.lands[0]).toMatchObject({ key: 'LADWP', name: 'Los Angeles Department of Water and Power' });
    expect(a.landBadge.text).toBe('Public');
  });
  it('a lake surface is public water and auto-detects as a lake', () => {
    const a = interpret(p, 'auto', { ...inland, waterBody: [{ NAME: 'Tahoe, Lake', FTYPE: 'Lake/Pond' }] });
    expect(a).toMatchObject({ water: 'lake', landBadge: { status: 'ok', text: 'Public water (lake surface)' } });
    expect(a.trout).toMatchObject({ open: true, source: 'statewide §5.85(a)(1)' });
  });
  it('nonprofit conservation land is private, and names come from the federal layer when agencies agree', () => {
    expect(interpret(p, 'auto', { ...inland, own: [{ Own_Level: 'Non Profit', Own_Agency: 'Ag Land Trust' }] }).landBadge.text).toBe('Private conservation land');
    const a = interpret(p, 'auto', { ...inland, own: [{ Own_Level: 'Federal', Own_Group: 'US Forest Service', Own_Agency: 'United States Forest Service' }],
      fed: [{ Agency: 'Forest Service', unit_name: 'Inyo National Forest' }] });
    expect(a.lands[0]).toMatchObject({ key: 'USFS', name: 'Inyo National Forest' });
  });
  it('falls back to federal/parks layers when ownership fails', () => {
    const a = interpret(p, 'auto', { ...inland, own: null, fed: [{ Agency: 'Bureau of Land Management', unit_name: 'Bishop Field Office' }] });
    expect(a.lands[0].key).toBe('BLM');
    expect(a.errors).toContain('land ownership');
  });
  it('reports failed sources', () => {
    expect(interpret(p, 'auto', { ...base, fed: null }).errors).toContain('federal lands');
  });
  it('San Francisco Bay District is bay water under ocean rules, though inland district polygons cover it', () => {
    const district = { kind: KINDS[3], desc: 'South Central District', code: '7.00(e)' };
    const inBay = { ...base, dem: -1.3, geo: null, regs: { ...base.regs, hits: [district] }, bay: [{}], nearBay: [{}] };
    const a = interpret({ lat: 37.52, lng: -122.13 }, 'auto', inBay);
    expect(a.water).toBe('ocean');
    expect(a.trout).toBeNull();
    expect(a.notes.some(n => n.strong === 'San Francisco Bay District')).toBe(true);
    expect(interpret({ lat: 37.52, lng: -122.13 }, 'auto', { ...inBay, bay: [], nearBay: [] }).water).toBe('stream'); // Suisun side: inland
  });
  it('salt evaporation ponds are not lakes; next to the bay they count as bay water', () => {
    const pond = { NAME: ' ', FTYPE: 'Reservoir', FCODE_DESC: 'Reservoir: Reservoir Type = Evaporator' };
    const fws = { Own_Level: 'Federal', Own_Group: 'US Fish and Wildlife Service', Own_Agency: 'United States Fish and Wildlife Service' };
    const raw = { ...base, dem: 0.1, own: [fws], waterBody: [pond], regs: { ...base.regs, hits: [{ kind: KINDS[3], desc: 'South Central District', code: '7.00(e)' }] } };
    const byBay = interpret({ lat: 37.43357, lng: -122.04248 }, 'auto', { ...raw, nearBay: [{}] });
    expect(byBay.water).toBe('ocean');
    expect(byBay.trout).toBeNull();
    expect(byBay.verdict.status).toBe('warn'); // refuge: designated areas only
    expect(byBay.notes.some(n => n.strong === 'Salt evaporation pond')).toBe(true);
    expect(interpret({ lat: 35.5, lng: -117.4 }, 'auto', raw).water).toBe('stream'); // inland evaporator: not a lake either
    expect(interpret({ lat: 35.5, lng: -117.4 }, 'auto', { ...raw, waterBody: [{ NAME: 'Lake X', FTYPE: 'Reservoir', FCODE_DESC: 'Reservoir' }] }).water).toBe('lake');
  });
  it('coastal bays and harbors use ocean rules; a mapped lake inside the tidal extent stays a lake', () => {
    const raw = { ...base, dem: -2, geo: { address: { state: 'California', county: 'San Diego County' } }, coastalBay: [{ Estuary_Name: 'Mission Bay' }],
      regs: { ...base.regs, hits: [{ kind: KINDS[3], desc: 'South Coast District', code: '7.00(g)' }] } };
    const a = interpret({ lat: 32.775, lng: -117.225 }, 'auto', raw);
    expect(a.water).toBe('ocean');
    expect(a.trout).toBeNull();
    expect(a.notes.some(n => n.strong === 'Mission Bay')).toBe(true);
    expect(interpret({ lat: 37.8, lng: -122.26 }, 'auto', { ...raw, waterBody: [{ NAME: 'Merritt, Lake', FTYPE: 'Lake/Pond' }] }).water).toBe('lake');
    expect(interpret({ lat: 32.775, lng: -117.225 }, 'auto', { ...raw, coastalBay: [] }).water).toBe('stream');
  });
});

import { inCalifornia } from './california';
import { nearestBetween, pointInPolygon, projector } from './geo';

describe('california area', () => {
  it.each([
    ['Lake Tahoe (CA side)', 39.0, -120.05, true], ['Reno, NV', 39.53, -119.81, false], ['Monterey Bay offshore', 36.75, -122.0, true],
    ['Tijuana', 32.5, -117.02, false], ['Brookings, OR', 42.05, -124.28, false], ['Catalina Island', 33.38, -118.42, true],
    ['Yuma, AZ', 32.69, -114.62, false], ['Death Valley', 36.5, -117.1, true]
  ])('%s', (_n, lat, lng, expected) => expect(inCalifornia({ lat, lng })).toBe(expected));
});

describe('geo', () => {
  const proj = projector(37.6);
  it('finds a near pass even between sparse vertices', () => {
    const trail = [[[-119.0, 37.6], [-118.99, 37.6]]] as [number, number][][];          // ~880 m E-W segment
    const lake = [[[-118.995, 37.6009], [-118.995, 37.61]]] as [number, number][][];      // starts ~100 m north of its middle
    const hit = nearestBetween(trail, lake, proj, 400)!;
    expect(hit.meters).toBeGreaterThan(90); expect(hit.meters).toBeLessThan(110);
    expect(hit.at).toEqual([-118.995, 37.6009]);
    expect(nearestBetween(trail, lake, proj, 50)).toBeNull();
  });
  it('point in polygon', () => {
    const sq = [[[0, 0], [1, 0], [1, 1], [0, 1]]] as [number, number][][];
    expect(pointInPolygon([0.5, 0.5], sq)).toBe(true);
    expect(pointInPolygon([1.5, 0.5], sq)).toBe(false);
  });
});

import { nameScore, resolveHit } from './regdata';

describe('section-number check', () => {
  const index = [
    { code: '7.50(b)(157)', name: 'Twelvemile Creek (Modoc Co.).' },
    { code: '7.50(b)(158)', name: 'Twin Lakes (Mammoth, Mono Co.).' },
    { code: '7.50(b)(159)', name: 'Twin Lakes, Upper and Lower (Bridgeport, Mono Co.).' },
    { code: '7.50(b)(65)', name: 'Isabella Lake (Lake Isabella, Kern Co.).' }
  ];
  it('scores water names, using qualifiers to break ties', () => {
    expect(nameScore('Twin Lakes (Mammoth)', 'Twelvemile Creek (Modoc Co.).')).toBe(0);
    expect(nameScore('Twin Lakes (Mammoth)', 'Twin Lakes (Mammoth, Mono Co.).')).toBeGreaterThan(nameScore('Twin Lakes (Mammoth)', 'Twin Lakes, Upper and Lower (Bridgeport, Mono Co.).'));
    expect(nameScore('Isabelle Lake', 'Isabella Lake (Lake Isabella, Kern Co.).')).toBeGreaterThan(0);
  });
  it('re-points a mis-numbered map feature to the entry that names it', () => {
    expect(resolveHit({ code: '7.50(b)(157)', desc: 'Twin Lakes (Mammoth)' }, index)).toMatchObject({ code: '7.50(b)(158)', mapCode: '7.50(b)(157)' });
  });
  it('keeps correct codes and flags unmatched ones', () => {
    expect(resolveHit({ code: '7.50(b)(65)', desc: 'Isabelle Lake' }, index)).toEqual({ code: '7.50(b)(65)', desc: 'Isabelle Lake' });
    expect(resolveHit({ code: '7.50(b)(157)', desc: 'Nowhere Pond' }, index)).toMatchObject({ code: '7.50(b)(157)', unverified: true });
    expect(resolveHit({ code: '5.15(b)(7)', desc: 'Mono County' }, index)).toEqual({ code: '5.15(b)(7)', desc: 'Mono County' });
  });
});

import { boxTouchesCalifornia, clipToCalifornia } from './california';

describe('california data loading', () => {
  it('requests cells that touch California, skips ones that do not', () => {
    expect(boxTouchesCalifornia({ south: 37.5, west: -119.2, north: 37.7, east: -118.9 })).toBe(true);  // Mammoth
    expect(boxTouchesCalifornia({ south: 39.4, west: -119.9, north: 39.6, east: -119.7 })).toBe(false); // Reno: in CA's bbox, outside the state
    expect(boxTouchesCalifornia({ south: 38.9, west: -120.2, north: 39.3, east: -119.8 })).toBe(true);  // straddles the NV line at Tahoe
    expect(boxTouchesCalifornia({ south: 44, west: -124, north: 45, east: -123 })).toBe(false);         // Oregon
    expect(boxTouchesCalifornia({ south: 36, west: -123.5, north: 37, east: -122.5 })).toBe(true);      // ocean off Monterey
  });
  it('clips a search view to California', () => {
    expect(clipToCalifornia({ south: 41.5, west: -124.5, north: 43, east: -123 })).toMatchObject({ north: expect.closeTo(42.0, 1) });
    expect(clipToCalifornia({ south: 44, west: -124, north: 45, east: -123 })).toBeNull();
  });
});

import { californiaQueryArea, californiaQueryParams } from './california';

describe('california-clipped queries', () => {
  it('uses the plain box inside the state, a clipped polygon on the border, nothing outside', () => {
    expect(californiaQueryArea({ south: 37.55, west: -119.1, north: 37.7, east: -118.9 })).toEqual({ type: 'box' });
    const border = californiaQueryArea({ south: 38.7, west: -120.6, north: 39.6, east: -119.4 })!;
    expect(border.type).toBe('clipped');
    expect(californiaQueryArea({ south: 39.4, west: -119.9, north: 39.6, east: -119.7 })).toBeNull(); // Reno
  });
  it('emits ArcGIS polygons with clockwise outer rings', () => {
    const p = californiaQueryParams({ south: 38.7, west: -120.6, north: 39.6, east: -119.4 })!;
    expect(p.geometryType).toBe('esriGeometryPolygon');
    const ring: [number, number][] = JSON.parse(p.geometry).rings[0];
    const signedArea = ring.reduce((t, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return t + (x2 - x1) * (y2 + y1); }, 0);
    expect(signedArea).toBeGreaterThan(0); // shoelace with this sign convention: > 0 means clockwise
  });
});

import { citedBooklets, currentBooklet, freshness } from './regdata';

describe('regulation freshness', () => {
  it('knows the booklet in effect (Mar 1 - end of Feb)', () => {
    expect(currentBooklet(new Date(2026, 9, 14))).toBe('2026–2027');
    expect(currentBooklet(new Date(2027, 1, 28))).toBe('2026–2027');
    expect(currentBooklet(new Date(2027, 2, 1))).toBe('2027–2028');
  });
  it('reads booklet years leaked into the text (page numbers glued on)', () => {
    expect(citedBooklets(['…listed 312021-2022 Freshwater Sport Fishing Regulations in this…', '152022-2023 Freshwater Sport Fishing Regulations'])).toEqual(['2021–2022', '2022–2023']);
  });
  it('flags text older than the current booklet', () => {
    expect(freshness(null, ['2021–2022', '2022–2023'], new Date(2026, 9, 14))).toMatchObject({ stale: true, current: '2026–2027' });
    expect(freshness(null, ['2026–2027'], new Date(2026, 9, 14)).stale).toBe(false);
    expect(freshness(null, [], new Date(2026, 9, 14)).stale).toBe(false);
  });
});

import { summarizeGroup } from './rules';

describe('regulation summaries', () => {
  it('reads season and bag limit from a table row', () => {
    const group = { kind: KINDS[0], desc: 'A Lake', code: '7.50(b)(1)', rows: [{ code: '7.50(b)(1)', type: 'table', segments: [{ title: 'A Lake', fields: [
      { label: 'Open Season and Special Restrictions', value: 'Last Sat. in Apr. through Nov. 15.' }, { label: 'Daily Bag and Possession Limit', value: '2 trout' }] }] }] };
    expect(summarizeGroup(group as any, group, 'water').periods).toEqual([{ season: 'Last Sat. in Apr. through Nov. 15.', daily: 2, possession: null }]);
  });
});

import { ownershipWhere, PUBLIC_LAND, ALL_LAND } from './land';

describe('land type filters', () => {
  it('builds ownership SQL', () => {
    expect(ownershipWhere(ALL_LAND)).toBe('1=1');
    expect(ownershipWhere([])).toBe('1=0');
    expect(ownershipWhere(['USFS', 'LADWP'])).toBe("Own_Group = 'US Forest Service' OR (Own_Level IN ('City','County') AND Own_Agency LIKE '%Water and Power%')");
  });
  it('public default excludes military, tribal and nonprofit land', () => {
    expect(PUBLIC_LAND).not.toContain('DOD');
    expect(PUBLIC_LAND).not.toContain('TRIBAL');
    expect(PUBLIC_LAND).not.toContain('NONPROFIT');
    expect(PUBLIC_LAND).toEqual(expect.arrayContaining(['USFS', 'BLM', 'LADWP', 'CDFW', 'LOCAL']));
  });
});
