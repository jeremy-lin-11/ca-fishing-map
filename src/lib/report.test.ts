import { describe, expect, it } from 'vitest';
import { buildReport, reportText, type ReportContext } from './report';

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
});
