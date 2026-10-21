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
});
