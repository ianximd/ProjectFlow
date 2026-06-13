/**
 * Pure Goals progress math (Phase 8e). No I/O — heavily unit-tested.
 *
 * A Target's completion RATIO is in [0,1] and derived per kind:
 *   number/currency: (current - start) / (target - start)   (clamped 0..1)
 *   boolean:         1 when current >= 1, else 0
 *   task:            current (completed) / target (total)    (clamped 0..1)
 *
 * Goal PROGRESS is the equal-weighted average of its targets' ratios (no stored
 * goal-progress column — computed on read). An empty goal is 0.
 */

export type TargetKind = 'number' | 'boolean' | 'currency' | 'task';

export interface TargetShape {
  kind: TargetKind;
  startValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Completion ratio in [0,1] for a single target. */
export function targetRatio(t: TargetShape): number {
  const cur = t.currentValue ?? 0;
  switch (t.kind) {
    case 'boolean':
      return cur >= 1 ? 1 : 0;
    case 'task': {
      const total = t.targetValue ?? 0;
      if (total <= 0) return 0;
      return clamp01(cur / total);
    }
    case 'number':
    case 'currency':
    default: {
      const start = t.startValue ?? 0;
      const target = t.targetValue ?? 0;
      const span = target - start;
      if (span === 0) return 0;
      return clamp01((cur - start) / span);
    }
  }
}

/** Equal-weighted average of target ratios; 0 when there are no targets. */
export function goalProgress(targets: TargetShape[]): number {
  if (!targets.length) return 0;
  const sum = targets.reduce((acc, t) => acc + targetRatio(t), 0);
  return sum / targets.length;
}
