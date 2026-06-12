/**
 * Pure sprint cadence + auto-state math for Phase 8c. No I/O — unit-tested.
 * All date math is UTC so it matches SQL DATETIME2/DATE round-trips.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day UTC add. */
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/** True when a PLANNED sprint's StartDate has arrived (at or before `now`). */
export function shouldAutoStart(
  sprint: { status: string; startDate: Date | null },
  now: Date,
): boolean {
  if (sprint.status !== 'PLANNED') return false;
  if (!sprint.startDate) return false;
  return sprint.startDate.getTime() <= now.getTime();
}

/** True when an ACTIVE sprint's EndDate has passed (strictly before `now`). */
export function shouldAutoComplete(
  sprint: { status: string; endDate: Date | null },
  now: Date,
): boolean {
  if (sprint.status !== 'ACTIVE') return false;
  if (!sprint.endDate) return false;
  return sprint.endDate.getTime() < now.getTime();
}

export interface SprintWindow { start: Date; end: Date; }

/**
 * Compute the next sprint's [start, end) window.
 *   - start = the prior sprint's EndDate (back-to-back) unless StartDayOfWeek is
 *     set, in which case start snaps forward to the next matching weekday
 *     (0=Sun..6=Sat) AT OR AFTER the anchor. When there is no prior EndDate,
 *     the anchor is `now`.
 *   - end   = start + durationDays.
 */
export function nextSprintWindow(p: {
  priorEndDate: Date | null;
  durationDays: number;
  startDayOfWeek: number | null;
  now?: Date;
}): SprintWindow {
  const duration = p.durationDays > 0 ? p.durationDays : 14;
  const anchor = p.priorEndDate ?? p.now ?? new Date();
  let start = new Date(Date.UTC(
    anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(),
    anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds(),
  ));

  if (p.startDayOfWeek != null) {
    // Snap forward to the next matching weekday at or after the anchor.
    let guard = 0;
    while (start.getUTCDay() !== p.startDayOfWeek && guard < 7) {
      start = addDays(start, 1);
      guard++;
    }
  }

  return { start, end: addDays(start, duration) };
}

/** Select only unfinished task ids from a candidate set (status/resolved aware). */
export function selectRollForwardTasks(
  tasks: Array<{ id: string; status: string; resolvedAt: Date | null }>,
): string[] {
  const DONE = new Set(['Done', 'DONE']);
  return tasks
    .filter((t) => t.resolvedAt == null && !DONE.has(t.status))
    .map((t) => t.id);
}
