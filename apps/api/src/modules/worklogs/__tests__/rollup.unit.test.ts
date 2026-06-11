import { describe, it, expect } from 'vitest';
import { estimateVsActual, type RollupRow } from '../rollup.js';

describe('estimateVsActual', () => {
  it('computes ratio and remaining from a rollup row', () => {
    const row: RollupRow = { taskId: 't1', ownLoggedSeconds: 3600, ownEstimateSeconds: 7200, rollupLoggedSeconds: 10800, rollupEstimateSeconds: 14400 };
    const r = estimateVsActual(row);
    expect(r.loggedSeconds).toBe(10800);
    expect(r.estimateSeconds).toBe(14400);
    expect(r.ratio).toBeCloseTo(0.75, 5);
    expect(r.remainingSeconds).toBe(3600);
    expect(r.overBudget).toBe(false);
  });
  it('flags over-budget and clamps remaining at zero', () => {
    const row: RollupRow = { taskId: 't2', ownLoggedSeconds: 0, ownEstimateSeconds: 0, rollupLoggedSeconds: 20000, rollupEstimateSeconds: 10000 };
    const r = estimateVsActual(row);
    expect(r.ratio).toBeCloseTo(2, 5);
    expect(r.remainingSeconds).toBe(0);
    expect(r.overBudget).toBe(true);
  });
  it('returns null ratio when there is no estimate', () => {
    const row: RollupRow = { taskId: 't3', ownLoggedSeconds: 500, ownEstimateSeconds: null, rollupLoggedSeconds: 500, rollupEstimateSeconds: 0 };
    const r = estimateVsActual(row);
    expect(r.ratio).toBeNull();
    expect(r.remainingSeconds).toBeNull();
    expect(r.overBudget).toBe(false);
  });
});
