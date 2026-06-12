/**
 * Timesheet period math — a period is a Monday→Sunday week, expressed as two
 * `YYYY-MM-DD` strings (matching the API's `Timesheet.periodStart`/`periodEnd`).
 *
 * All arithmetic runs in UTC on date-only values so it is timezone- and
 * DST-independent: a `Date` argument contributes only its *local* calendar
 * Y/M/D, which we re-anchor at UTC midnight before any day math.
 */

export interface TimesheetPeriod {
  periodStart: string; // YYYY-MM-DD (Monday)
  periodEnd:   string; // YYYY-MM-DD (Sunday)
}

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toISODate(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** UTC-midnight epoch ms for a `YYYY-MM-DD` string. */
function parseISODateUTC(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The Mon→Sun week that contains `dateISO`. */
export function weekPeriodOf(dateISO: string): TimesheetPeriod {
  const utc = parseISODateUTC(dateISO);
  // getUTCDay: 0=Sun..6=Sat → days since Monday = (day + 6) % 7.
  const sinceMonday = (new Date(utc).getUTCDay() + 6) % 7;
  const mondayMs = utc - sinceMonday * DAY_MS;
  return {
    periodStart: toISODate(mondayMs),
    periodEnd:   toISODate(mondayMs + 6 * DAY_MS),
  };
}

/** The Mon→Sun week that contains `today` (defaults to now). */
export function currentWeekPeriod(today: Date = new Date()): TimesheetPeriod {
  // Use the local calendar day, then weekPeriodOf re-anchors it in UTC.
  const localISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return weekPeriodOf(localISO);
}

/** Shift a period by whole weeks (negative = earlier). */
export function shiftWeekPeriod(period: TimesheetPeriod, deltaWeeks: number): TimesheetPeriod {
  const mondayMs = parseISODateUTC(period.periodStart) + deltaWeeks * 7 * DAY_MS;
  return {
    periodStart: toISODate(mondayMs),
    periodEnd:   toISODate(mondayMs + 6 * DAY_MS),
  };
}
