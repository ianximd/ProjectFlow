const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day column index of `date` relative to `origin` (both date-or-ISO strings). */
export function dayIndex(origin: string, date: string): number {
  const o = Date.parse(origin.length === 10 ? `${origin}T00:00:00Z` : origin);
  const d = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
  return Math.round((d - o) / MS_PER_DAY);
}

export interface BarGeom { x: number; width: number; hidden: boolean }

/** A bar's pixel x/width given the chart origin day, the task window, and px/day.
 *  Unscheduled (missing either end) → hidden. Width is clamped to one column. */
export function barGeometry(origin: string, start: string | null, due: string | null, pxPerDay: number): BarGeom {
  if (!start || !due) return { x: 0, width: 0, hidden: true };
  const s = dayIndex(origin, start);
  const e = dayIndex(origin, due);
  const span = Math.max(1, e - s);
  return { x: s * pxPerDay, width: Math.max(pxPerDay, span * pxPerDay), hidden: false };
}

/** SVG elbow path between a source point (a bar's right edge) and a target
 *  (a dependent bar's left edge) for a dependency line. */
export function lanePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}
