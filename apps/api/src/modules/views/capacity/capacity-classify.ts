import type { CapacityStatus } from '@projectflow/types';

/** Tolerance band (fraction of capacity) within which assigned load counts as
 *  "at" capacity rather than over/under. 2% absorbs rounding (e.g. 7.5h vs 8h). */
const AT_TOLERANCE = 0.02;

export interface CapacityClassification {
  status: CapacityStatus;   // 'over' | 'at' | 'under'
  ratio: number;            // assigned / capacity (Infinity when capacity == 0 and assigned > 0)
}

/**
 * Pure classifier: compare an assignee's assigned load (seconds OR points — the
 * caller decides the unit) against their capacity in the same unit. No I/O.
 *   - capacity <= 0 & assigned > 0 → 'over' (ratio Infinity)
 *   - capacity <= 0 & assigned == 0 → 'under' (ratio 0)
 *   - |ratio - 1| <= AT_TOLERANCE   → 'at'
 *   - ratio > 1                     → 'over'
 *   - else                          → 'under'
 */
export function classifyCapacity(assigned: number, capacity: number): CapacityClassification {
  const a = Number.isFinite(assigned) && assigned > 0 ? assigned : 0;
  const c = Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
  if (c === 0) {
    return a > 0 ? { status: 'over', ratio: Infinity } : { status: 'under', ratio: 0 };
  }
  const ratio = a / c;
  if (Math.abs(ratio - 1) <= AT_TOLERANCE) return { status: 'at', ratio };
  return { status: ratio > 1 ? 'over' : 'under', ratio };
}
