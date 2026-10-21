import { describe, expect, it } from 'vitest';
import { estimatePressure, type PressureRaw } from './pressure';

const none: PressureRaw = { roads: [0, 0, 0], people: 0, stocked: [], plantings: [], wilderness: [], coastalAccess: [], sites: [] };
const tue = new Date(2026, 9, 20), sat = new Date(2026, 9, 24);
const est = (r: Partial<PressureRaw>, o: Partial<{ catchAndRelease: boolean; today: Date }> = {}) =>
  estimatePressure({ ...none, ...r }, { catchAndRelease: false, today: tue, ...o });

describe('estimated fishing pressure', () => {
  it('a remote wilderness lake is low, with reasons', () => {
    const p = est({ wilderness: [{ NAME: 'Ansel Adams Wilderness' }] });
    expect(p.level).toBe('low');
    expect(p.reasons.map(r => r.text)).toEqual(['No road within 3 miles', 'Inside the Ansel Adams Wilderness: foot or horse access only']);
    expect(p.reasons.every(r => r.effect === -1)).toBe(true);
  });
  it('a metro pier with parking is high', () => {
    const p = est({ roads: [10, 85, 400], people: 3_400_000, coastalAccess: [{ Name: 'Pacifica Pier' }] });
    expect(p.level).toBe('high');
    expect(p.reasons.map(r => r.text)).toContain('About 3.4 million people live within 30 miles');
  });
  it('a recent CDFW planting outweighs an older stocking year', () => {
    const stocked = [{ StockingWaterID: 17884, last_yr_stkd: 2025 }];
    const recent = est({ roads: [0, 2, 5], stocked, plantings: [{ WeekOfPlantStart: '2026-10-04', FishType: 'Trout' }] });
    expect(recent.reasons.map(r => r.text)).toContain('CDFW planted trout here the week of Oct 4');
    expect(recent.level).toBe('moderate');
    const old = est({ roads: [0, 2, 5], stocked, plantings: [{ WeekOfPlantStart: '2026-05-01', FishType: 'Trout' }] });
    expect(old.score).toBe(recent.score - 1);
    expect(old.reasons.map(r => r.text)).toContain('Stocked by CDFW (last planted the week of May 1)');
  });
  it('catch-and-release lowers it; weekends raise it', () => {
    expect(est({}, { catchAndRelease: true }).score).toBe(est({}).score - 1);
    expect(est({}, { today: sat }).reasons.map(r => r.text)).toContain('Weekend');
  });
  it('lists signals that failed to load instead of guessing', () => {
    const p = est({ roads: null, stocked: null });
    expect(p.missing).toEqual(['roads', 'CDFW stocking']);
  });
});

