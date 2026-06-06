/**
 * Date <-> day-offset conversion for templates (Phase 5d).
 *
 * A template stores every date as a WHOLE-DAY offset from a reference anchor so
 * apply can remap the entire captured subtree onto a freshly-chosen anchor:
 *   captured:  dateToOffset(taskDue, captureAnchor) -> e.g. +3
 *   applied:   offsetToDate(+3, chosenAnchor)       -> chosenAnchor + 3 days
 *
 * Offsets are measured in whole UTC days between the date's midnight and the
 * anchor's midnight, so capture/apply are timezone-stable and round-trip
 * exactly. A null input yields null (an unset date stays unset).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DateInput = Date | string | null | undefined;

function toDate(d: DateInput): Date | null {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** UTC midnight of the given date, as epoch millis. */
function utcMidnightMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Whole-day offset of `date` relative to `anchor` (both floored to UTC
 * midnight). Returns null when either input is null/invalid. Negative when the
 * date precedes the anchor.
 */
export function dateToOffset(date: DateInput, anchor: DateInput): number | null {
  const d = toDate(date);
  const a = toDate(anchor);
  if (!d || !a) return null;
  return Math.round((utcMidnightMs(d) - utcMidnightMs(a)) / MS_PER_DAY);
}

/**
 * Reconstruct a Date from a day-offset against `anchor` (anchor floored to UTC
 * midnight, then offset whole days added). Returns null when offset is
 * null/undefined or the anchor is null/invalid.
 */
export function offsetToDate(offset: number | null | undefined, anchor: DateInput): Date | null {
  if (offset == null) return null;
  const a = toDate(anchor);
  if (!a) return null;
  return new Date(utcMidnightMs(a) + offset * MS_PER_DAY);
}
