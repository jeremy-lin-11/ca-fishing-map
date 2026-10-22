import { describe, expect, it } from 'vitest';
import { buildReport, issueUrl, reportText, type ReportContext } from './report';

const ctx: ReportContext = {
  point: { lat: 37.296861234, lng: -122.077371234 }, view: { lat: 37.2972, lng: -122.0677, zoom: 15 },
  link: 'https://example.org/ca-fishing-map/#map=37.2972,-122.0677,15&pt=37.29686,-122.07737', result: null,
  waterSelection: 'auto', layers: ['land', 'regwaters'], basemap: 'topo', online: true, offlineArea: null,
  version: 'abc1234', userAgent: 'test', screen: '390x844'
};

describe('problem reports', () => {
  it('includes the point, view and link when the reporter shares location', () => {
    const r = buildReport({ category: 'water', notes: '  should be a reservoir ', email: '', includeLocation: true }, ctx);
    expect(r).toMatchObject({ category: 'water', notes: 'should be a reservoir', email: null, location_shared: true,
      point_lat: 37.29686, point_lng: -122.07737, view: '37.2972,-122.0677 z15', link: ctx.link, layers: 'land,regwaters' });
  });
  it('sends no location at all when unchecked', () => {
    const r = buildReport({ category: 'app', notes: 'x', email: 'a@b.c', includeLocation: false }, { ...ctx, offlineArea: 'Mammoth trip' });
    for (const k of ['point_lat', 'point_lng', 'view', 'link', 'county']) expect(r).not.toHaveProperty(k);
    expect(r.offline_area).toBe('yes'); // that an offline area was used, not its name
    expect(JSON.stringify(r)).not.toMatch(/37\.29|Mammoth/);
  });
  it('copies as readable text without empty fields', () => {
    const t = reportText(buildReport({ category: 'other', notes: 'hi', email: '', includeLocation: false }, ctx));
    expect(t).toContain('notes: hi');
    expect(t).not.toContain('email:');
  });
  it('makes a pre-filled GitHub issue without the email, under the URL length limit', () => {
    const r = buildReport({ category: 'water', notes: 'Should be a reservoir', email: 'me@example.com', includeLocation: true }, ctx);
    const u = new URL(issueUrl('https://github.com/o/r/issues/new', r));
    expect(u.searchParams.get('title')).toBe('Problem report: Wrong water type (lake / stream / ocean)');
    const body = u.searchParams.get('body')!;
    expect(body.startsWith('Should be a reservoir')).toBe(true);
    expect(body).toContain('point_lat: 37.29686');
    expect(body).not.toContain('me@example.com');
    const long = buildReport({ category: 'app', notes: 'x'.repeat(4000), email: '', includeLocation: true }, { ...ctx, userAgent: 'y'.repeat(3000) });
    expect(issueUrl('https://github.com/o/r/issues/new', long).length).toBeLessThanOrEqual(7500);
    const wide = buildReport({ category: 'app', notes: '湖'.repeat(4000), email: '', includeLocation: false }, ctx);
    expect(issueUrl('https://github.com/o/r/issues/new', wide).length).toBeLessThanOrEqual(7500);
  });
  it('without location consent, the answer is sent as categories: no names or section numbers', () => {
    const result = { point: ctx.point!, water: 'lake', county: 'Mono County', verdict: { status: 'warn', text: 'Fishing allowed, but unit-specific rules apply' },
      lands: [{ name: 'Inyo National Forest', key: 'USFS', type: '' }], landBadge: { status: 'ok', text: 'Public' },
      notes: [{ strong: 'Twin Lakes', text: ': …' }], depth: [], errors: [],
      regs: { special: [{ code: '7.50(b)(158)' }], general: [] },
      trout: { open: true, keep: true, daily: 5, possession: 10, source: '§7.50(b)(158)', note: 'Open Jul 6', caveats: [] },
      pressure: { level: 'low', score: 0, reasons: [{ text: 'Inside the Ansel Adams Wilderness', effect: -1 }], missing: [] } } as any;
    const r = buildReport({ category: 'regs', notes: 'x', email: '', includeLocation: false }, { ...ctx, result });
    expect(r).toMatchObject({ answer_water: 'lake', answer_verdict: 'warn', answer_land: 'USFS', answer_trout: 'open, 5/day', answer_pressure: 'low' });
    expect(JSON.stringify(r)).not.toMatch(/Twin|Inyo|Ansel|7\.50|Mono/);
    const shared = buildReport({ category: 'regs', notes: 'x', email: '', includeLocation: true }, { ...ctx, result });
    expect(shared.answer_land).toBe('Inyo National Forest (USFS)');
    expect(shared.answer_special_regs).toBe('7.50(b)(158)');
  });
});
