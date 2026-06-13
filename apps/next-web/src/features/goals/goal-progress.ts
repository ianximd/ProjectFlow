// Client mirror of apps/api/src/modules/goals/goal-progress.ts (Phase 8e). Keep in sync.

export type TargetKind = 'number' | 'boolean' | 'currency' | 'task';

export interface TargetShape {
  kind: TargetKind;
  startValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function targetRatio(t: TargetShape): number {
  const cur = t.currentValue ?? 0;
  if (t.kind === 'boolean') return cur >= 1 ? 1 : 0;
  if (t.kind === 'task') {
    const total = t.targetValue ?? 0;
    return total <= 0 ? 0 : clamp01(cur / total);
  }
  const start = t.startValue ?? 0;
  const span = (t.targetValue ?? 0) - start;
  return span === 0 ? 0 : clamp01((cur - start) / span);
}

export function goalProgress(targets: TargetShape[]): number {
  if (!targets.length) return 0;
  return targets.reduce((acc, t) => acc + targetRatio(t), 0) / targets.length;
}
