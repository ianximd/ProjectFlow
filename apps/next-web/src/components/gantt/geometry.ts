// ─── Gantt timeline geometry ──────────────────────────────────────────────────
// Pure, framework-free positioning math for the roadmap Gantt. Kept separate
// from the React component so the pixel↔date mapping can be unit-tested in
// isolation — that mapping is exactly where the timeline used to drift.

export type ZoomLevel = 'day' | 'week' | 'month';

export const ZOOM_CFG = {
  day:   { label: 'Day',   colPx: 36,  unitDays: 1,  padDays: 14 },
  week:  { label: 'Week',  colPx: 70,  unitDays: 7,  padDays: 28 },
  month: { label: 'Month', colPx: 120, unitDays: 30, padDays: 90 },
} as const satisfies Record<ZoomLevel, { label: string; colPx: number; unitDays: number; padDays: number }>;

export const DAY_MS = 86_400_000;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── Date helpers ──────────────────────────────────────────────────────────────

export function startOfDay(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Date-only strings ("2026-05-18") MUST be interpreted as local midnight,
  // not UTC. `new Date("2026-05-18")` parses as UTC midnight, which in any
  // non-UTC timezone resolves to the wrong calendar day locally — bars would
  // visually trail the cursor by one day during drag and snap to a different
  // column on commit.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(s);
  if (m) {
    return startOfDay(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return startOfDay(d);
}

export function toIsoDate(d: Date): string {
  // Local components so the round-trip is timezone-stable. `toISOString` would
  // shift the calendar day for any non-UTC user.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

// ─── Column slots ──────────────────────────────────────────────────────────────

// Build the list of column start-dates spanning [rangeStart, rangeEnd] for the
// chosen zoom. slots[0] is the canonical positioning origin for the whole chart
// — every bar, the today-line and scroll targets are measured from it so they
// stay locked to the grid.
export function buildSlots(zoom: ZoomLevel, rangeStart: Date, rangeEnd: Date): Date[] {
  const slots: Date[] = [];
  if (zoom === 'day') {
    const cur = new Date(rangeStart);
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
  } else if (zoom === 'week') {
    // Start from the Monday of the week containing rangeStart.
    const cur = new Date(rangeStart);
    const dow = cur.getDay();
    cur.setDate(cur.getDate() - (dow === 0 ? 6 : dow - 1));
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setDate(cur.getDate() + 7); }
  } else {
    // month: start of each calendar month.
    const cur = new Date(rangeStart);
    cur.setDate(1);
    while (cur <= rangeEnd) { slots.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
  }
  return slots;
}

// ─── Range ─────────────────────────────────────────────────────────────────────

export interface DatedItem { startDate: string | null; dueDate: string | null }

// Span all scheduled work plus zoom-dependent padding, falling back to a window
// around today when nothing is scheduled. Today is always kept in-range so the
// today-line is reachable.
export function computeRange(
  items: readonly DatedItem[],
  today: Date,
  padDays: number,
): { rangeStart: Date; rangeEnd: Date } {
  const dates: number[] = [];
  for (const it of items) {
    const s = parseDate(it.startDate);
    const e = parseDate(it.dueDate);
    if (s) dates.push(s.getTime());
    if (e) dates.push(e.getTime());
  }
  let dataMin = dates.length ? new Date(Math.min(...dates)) : addDays(today, -7);
  let dataMax = dates.length ? new Date(Math.max(...dates)) : addDays(today, 30);
  if (today < dataMin) dataMin = new Date(today);
  if (today > dataMax) dataMax = new Date(today);
  return {
    rangeStart: addDays(dataMin, -padDays),
    rangeEnd:   addDays(dataMax,  padDays),
  };
}

// ─── Pixel mapping ─────────────────────────────────────────────────────────────

// Map a calendar date to an x-offset (px) inside the slot grid. Positions are
// interpolated *within* the containing slot, so day/week/month all stay locked
// to their columns — including months of unequal length, which a flat
// "days × pxPerDay" formula drifts away from across a year.
export function dateToPx(date: Date, slots: Date[], colPx: number, unitDays: number): number {
  if (slots.length === 0) return 0;
  const first = slots[0]!;
  if (date.getTime() <= first.getTime()) {
    // Extrapolate to the left using the first slot's real day-width.
    const firstEnd = slots[1] ?? addDays(first, unitDays);
    const spanMs = firstEnd.getTime() - first.getTime();
    return ((date.getTime() - first.getTime()) / spanMs) * colPx;
  }
  let i = 0;
  while (i < slots.length - 1 && date.getTime() >= slots[i + 1]!.getTime()) i++;
  const slotStart = slots[i]!;
  const slotEnd   = i < slots.length - 1 ? slots[i + 1]! : addDays(slotStart, unitDays);
  const frac = (date.getTime() - slotStart.getTime()) / (slotEnd.getTime() - slotStart.getTime());
  return (i + frac) * colPx;
}

// Bar geometry for an item. The bar spans [start, due] INCLUSIVE of the due day
// — a one-day task fills its column and a Mon–Wed task visually covers Wed,
// matching the duration shown in the drag tooltip. Falls back to a single-day
// block when only one of the two dates is set. Returns null when neither is.
export function barGeometry(
  item: DatedItem,
  slots: Date[],
  colPx: number,
  unitDays: number,
): { left: number; width: number } | null {
  const sd = parseDate(item.startDate);
  const ed = parseDate(item.dueDate);
  const s = sd ?? ed;
  const e = ed ?? sd;
  if (!s || !e) return null;
  const left  = dateToPx(s, slots, colPx, unitDays);
  const right = dateToPx(addDays(e, 1), slots, colPx, unitDays); // inclusive end-of-day
  const width = Math.max(colPx * 0.4, right - left);
  return { left, width };
}
