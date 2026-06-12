import { classifyCapacity } from './capacity-classify.js';
import type { CapacityMetric, CapacityResult, CapacityRow } from '@projectflow/types';

/** One SQL row from ViewRepository.capacityByAssignee (PascalCase). */
export interface RawCapacityRow {
  UserId: string;
  Name: string | null;
  Email: string | null;
  AvatarUrl: string | null;
  AssignedSeconds: number | null;
  AssignedPoints: number | null;
  TaskCount: number | null;
}

export interface AggregateOpts {
  metric: CapacityMetric;
  from: string | null;
  to: string | null;
  /** Per-assignee daily capacity in seconds (metric='time'). */
  capacityPerDaySeconds?: number;
  /** Per-assignee capacity in points (metric='points'). */
  capacityPerSprintPoints?: number;
  /** Inclusive day-span of [from,to]; multiplies capacityPerDaySeconds. 0 = use the per-day value as-is. */
  days: number;
}

/**
 * PURE fold: raw per-assignee SQL rows → a classified CapacityResult. Capacity in
 * the active metric's unit = (per-day seconds * days) for 'time', or
 * (per-sprint points) for 'points'. Rows are sorted by descending ratio so the
 * most-overloaded assignee is first (the Workload view renders + flags top-down).
 */
export function aggregateCapacity(raw: RawCapacityRow[], opts: AggregateOpts): CapacityResult {
  const capacity =
    opts.metric === 'time'
      ? (opts.capacityPerDaySeconds ?? 0) * (opts.days > 0 ? opts.days : 1)
      : (opts.capacityPerSprintPoints ?? 0);

  const rows: CapacityRow[] = raw.map((r) => {
    const assignedSeconds = Number(r.AssignedSeconds ?? 0);
    const assignedPoints = Number(r.AssignedPoints ?? 0);
    const assigned = opts.metric === 'time' ? assignedSeconds : assignedPoints;
    const { status, ratio } = classifyCapacity(assigned, capacity);
    return {
      userId: r.UserId,
      name: r.Name ?? null,
      email: r.Email ?? null,
      avatarUrl: r.AvatarUrl ?? null,
      assignedSeconds,
      assignedPoints,
      taskCount: Number(r.TaskCount ?? 0),
      capacity,
      status,
      ratio,
    };
  });

  rows.sort((a, b) => {
    const ra = a.ratio === Infinity ? Number.MAX_VALUE : a.ratio;
    const rb = b.ratio === Infinity ? Number.MAX_VALUE : b.ratio;
    return rb - ra;
  });

  return { metric: opts.metric, from: opts.from, to: opts.to, rows };
}
