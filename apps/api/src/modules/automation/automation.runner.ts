/**
 * Pure (side-effect-free) helpers for the automation action runner.
 *
 * - `nextDelayedSlice`   — partitions an action list into "run now" and the
 *   index at which execution should resume after a delay.
 * - `cronWindowElapsed`  — true when at least one cron tick falls in (since, now].
 */
import parser from 'cron-parser';
import type { AutomationAction } from '@projectflow/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DelayedSlice {
  /** Indices (within the original actions array) to execute in this slice. */
  runNow:   number[];
  /** Index of the next action to run after the delay, or null when done. */
  resumeAt: number | null;
  /** Milliseconds to wait before resuming at `resumeAt` (0 when resumeAt is null). */
  delayMs:  number;
}

// ── nextDelayedSlice ──────────────────────────────────────────────────────────

/**
 * Walk the action list starting at `fromIndex`. The action AT fromIndex always
 * runs now (its delay was already paid by the delayed-job timer). Each
 * subsequent action runs now until one has a positive `delaySeconds` — that
 * index becomes `resumeAt` and execution stops.
 *
 * Non-positive or missing `delaySeconds` counts as no delay.
 */
export function nextDelayedSlice(
  actions: AutomationAction[],
  fromIndex: number,
): DelayedSlice {
  const runNow: number[] = [];

  for (let i = fromIndex; i < actions.length; i++) {
    // When this is a resume invocation (fromIndex > 0), the action AT fromIndex
    // has already had its delay paid by the delayed-job timer — run it
    // unconditionally. For all other positions (and for the initial call where
    // fromIndex === 0), check the delay and defer if positive.
    const isPrePaid = i === fromIndex && fromIndex > 0;

    if (!isPrePaid) {
      const delay = actions[i].delaySeconds;
      const hasDelay = typeof delay === 'number' && delay > 0;

      if (hasDelay) {
        // Stop here — this action needs to be deferred.
        return { runNow, resumeAt: i, delayMs: (delay as number) * 1_000 };
      }
    }

    runNow.push(i);
  }

  return { runNow, resumeAt: null, delayMs: 0 };
}

// ── cronWindowElapsed ─────────────────────────────────────────────────────────

/**
 * Returns `true` iff the cron expression has at least one tick in the
 * half-open interval (since, now]. Returns `false` — never throws — for
 * invalid expressions or when no tick falls in the window.
 *
 * Uses cron-parser v4: `parser.parseExpression(cron, { currentDate, tz })`.
 */
export function cronWindowElapsed(cron: string, since: Date, now: Date): boolean {
  try {
    const interval = parser.parseExpression(cron, { currentDate: since, tz: 'UTC' });
    const next = interval.next().toDate();
    // Tick must be strictly after `since` (next() guarantees that) and at or
    // before `now`.
    return next <= now;
  } catch {
    return false;
  }
}
