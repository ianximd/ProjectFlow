import { describe, it, expect } from 'vitest';
import { targetRatio, goalProgress, type TargetShape } from '../goal-progress.js';

const t = (p: Partial<TargetShape>): TargetShape => ({
  kind: 'number', startValue: null, targetValue: null, currentValue: null, ...p,
});

describe('targetRatio', () => {
  it('number: (current - start) / (target - start), clamped 0..1', () => {
    expect(targetRatio(t({ kind: 'number', startValue: 0, targetValue: 100, currentValue: 25 }))).toBeCloseTo(0.25);
    expect(targetRatio(t({ kind: 'number', startValue: 10, targetValue: 20, currentValue: 15 }))).toBeCloseTo(0.5);
  });

  it('number: below start clamps to 0, above target clamps to 1', () => {
    expect(targetRatio(t({ kind: 'number', startValue: 10, targetValue: 20, currentValue: 5 }))).toBe(0);
    expect(targetRatio(t({ kind: 'number', startValue: 10, targetValue: 20, currentValue: 99 }))).toBe(1);
  });

  it('number: degenerate target===start → 0 (no progress definable)', () => {
    expect(targetRatio(t({ kind: 'number', startValue: 5, targetValue: 5, currentValue: 5 }))).toBe(0);
  });

  it('currency: same formula as number', () => {
    expect(targetRatio(t({ kind: 'currency', startValue: 0, targetValue: 1000, currentValue: 500 }))).toBeCloseTo(0.5);
  });

  it('boolean: 1 when current >= 1, else 0', () => {
    expect(targetRatio(t({ kind: 'boolean', currentValue: 1 }))).toBe(1);
    expect(targetRatio(t({ kind: 'boolean', currentValue: 0 }))).toBe(0);
    expect(targetRatio(t({ kind: 'boolean', currentValue: null }))).toBe(0);
  });

  it('task: completed (current) / total (target), clamped, 0 when no tasks', () => {
    expect(targetRatio(t({ kind: 'task', currentValue: 3, targetValue: 4 }))).toBeCloseTo(0.75);
    expect(targetRatio(t({ kind: 'task', currentValue: 4, targetValue: 4 }))).toBe(1);
    expect(targetRatio(t({ kind: 'task', currentValue: 0, targetValue: 0 }))).toBe(0);
  });

  it('null current → 0 for value kinds', () => {
    expect(targetRatio(t({ kind: 'number', startValue: 0, targetValue: 100, currentValue: null }))).toBe(0);
  });
});

describe('goalProgress', () => {
  it('equal-weighted average of target ratios', () => {
    const targets: TargetShape[] = [
      t({ kind: 'boolean', currentValue: 1 }),                                    // 1
      t({ kind: 'number', startValue: 0, targetValue: 100, currentValue: 50 }),   // 0.5
      t({ kind: 'task', currentValue: 0, targetValue: 4 }),                       // 0
    ];
    expect(goalProgress(targets)).toBeCloseTo((1 + 0.5 + 0) / 3);
  });

  it('no targets → 0', () => {
    expect(goalProgress([])).toBe(0);
  });

  it('all complete → 1', () => {
    expect(goalProgress([t({ kind: 'boolean', currentValue: 1 }), t({ kind: 'task', currentValue: 2, targetValue: 2 })])).toBe(1);
  });
});
