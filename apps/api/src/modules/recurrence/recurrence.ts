/**
 * Pure recurrence math for Phase 5c. No I/O — heavily unit-tested.
 *
 * Rule shape (RRULE-ish):
 *   { freq:'daily'|'weekly'|'monthly'|'yearly', interval:number,
 *     byWeekday?:number[] (0=Sun..6=Sat), byMonthday?:number (1..31),
 *     endsAt?:ISO string, count?:number }
 *
 * `computeNextOccurrence(rule, from)` returns the next occurrence STRICTLY after
 * `from`, or null when the rule has ended (past `endsAt`). All date math is in
 * UTC so it matches the SQL DATETIME2/DATE round-trips used elsewhere.
 *
 * `count` is NOT enforced here — it is intentionally caller-driven (the
 * recurrence service tracks how many occurrences have been spawned and stops
 * when the count is exhausted). Keeping this function pure on freq/interval/
 * byX/endsAt makes it trivially testable and reusable for both the on-complete
 * and scheduled-sweep paths.
 */

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRuleShape {
  freq: RecurrenceFreq;
  interval: number;
  byWeekday?: number[];
  byMonthday?: number;
  endsAt?: string;
  count?: number;
}

/** Thrown by validateRule on a malformed rule. Carries a stable code. */
export class InvalidRecurrenceRuleError extends Error {
  code = 'INVALID_RECURRENCE_RULE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecurrenceRuleError';
  }
}

const FREQS: ReadonlySet<string> = new Set(['daily', 'weekly', 'monthly', 'yearly']);

/**
 * Validate + normalize a raw rule object. Throws InvalidRecurrenceRuleError on
 * any structural problem (bad freq, interval <= 0, out-of-range byWeekday/
 * byMonthday, non-finite/invalid endsAt, count <= 0). Returns the typed rule.
 */
export function validateRule(raw: unknown): RecurrenceRuleShape {
  if (raw == null || typeof raw !== 'object') {
    throw new InvalidRecurrenceRuleError('Rule must be an object');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.freq !== 'string' || !FREQS.has(r.freq)) {
    throw new InvalidRecurrenceRuleError(`freq must be one of daily|weekly|monthly|yearly (got ${String(r.freq)})`);
  }

  const interval = r.interval;
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval <= 0) {
    throw new InvalidRecurrenceRuleError('interval must be a positive integer');
  }

  let byWeekday: number[] | undefined;
  if (r.byWeekday !== undefined && r.byWeekday !== null) {
    if (!Array.isArray(r.byWeekday)) throw new InvalidRecurrenceRuleError('byWeekday must be an array');
    byWeekday = r.byWeekday.map((d) => {
      if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) {
        throw new InvalidRecurrenceRuleError('byWeekday entries must be integers 0..6');
      }
      return d;
    });
    if (byWeekday.length === 0) byWeekday = undefined;
  }

  let byMonthday: number | undefined;
  if (r.byMonthday !== undefined && r.byMonthday !== null) {
    if (typeof r.byMonthday !== 'number' || !Number.isInteger(r.byMonthday) || r.byMonthday < 1 || r.byMonthday > 31) {
      throw new InvalidRecurrenceRuleError('byMonthday must be an integer 1..31');
    }
    byMonthday = r.byMonthday;
  }

  let endsAt: string | undefined;
  if (r.endsAt !== undefined && r.endsAt !== null && r.endsAt !== '') {
    if (typeof r.endsAt !== 'string' || Number.isNaN(new Date(r.endsAt).getTime())) {
      throw new InvalidRecurrenceRuleError('endsAt must be a valid ISO date string');
    }
    endsAt = r.endsAt;
  }

  let count: number | undefined;
  if (r.count !== undefined && r.count !== null) {
    if (typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count <= 0) {
      throw new InvalidRecurrenceRuleError('count must be a positive integer');
    }
    count = r.count;
  }

  return { freq: r.freq as RecurrenceFreq, interval, byWeekday, byMonthday, endsAt, count };
}

/** Number of days in `month` (0-indexed) of `year`, UTC. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Build a UTC date carrying `from`'s time-of-day at the given y/m/d, clamping
 *  the day to the month's length (Jan-31 → Feb-28/29). */
function atDay(from: Date, year: number, month: number, day: number): Date {
  const clamped = Math.min(day, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, clamped, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

/** Whole-day UTC add. */
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Next occurrence strictly after `from`, or null if past `endsAt`.
 * `rule` is assumed already validated (callers run validateRule first).
 */
export function computeNextOccurrence(rule: RecurrenceRuleShape, from: Date | string): Date | null {
  const start = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(start.getTime())) return null;

  const interval = rule.interval > 0 ? rule.interval : 1;
  let next: Date | null = null;

  switch (rule.freq) {
    case 'daily': {
      next = addDays(start, interval);
      break;
    }

    case 'weekly': {
      if (rule.byWeekday && rule.byWeekday.length) {
        // Find the next matching weekday. Within the current week stride, step a
        // day at a time until we hit one of byWeekday; if none remain this week,
        // jump to the start of the week `interval` weeks ahead and take the
        // earliest matching weekday there.
        const wanted = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
        // Scan up to interval*7 + 7 days ahead — guaranteed to find a match.
        for (let i = 1; i <= interval * 7 + 7; i++) {
          const cand = addDays(start, i);
          if (!wanted.includes(cand.getUTCDay())) continue;
          // Determine which "week stride" this candidate falls in relative to start.
          // Week boundaries are Sunday-based (getUTCDay 0=Sun). Compute the count
          // of week-starts crossed; require it to be a multiple of interval.
          const weeksAhead = weekIndexDelta(start, cand);
          if (weeksAhead === 0 || weeksAhead % interval === 0) {
            next = cand;
            break;
          }
        }
        if (!next) next = addDays(start, interval * 7); // safety fallback
      } else {
        next = addDays(start, interval * 7);
      }
      break;
    }

    case 'monthly': {
      const day = rule.byMonthday ?? start.getUTCDate();
      // Advance `interval` months at a time until we land strictly after `start`.
      let y = start.getUTCFullYear();
      let m = start.getUTCMonth();
      // First try the same anchor month with the target day (handles "later this
      // month" when byMonthday > start day).
      let cand = atDay(start, y, m, day);
      if (cand.getTime() <= start.getTime()) {
        m += interval;
        y += Math.floor(m / 12);
        m = ((m % 12) + 12) % 12;
        cand = atDay(start, y, m, day);
      }
      next = cand;
      break;
    }

    case 'yearly': {
      const day = rule.byMonthday ?? start.getUTCDate();
      const month = start.getUTCMonth();
      let y = start.getUTCFullYear();
      let cand = atDay(start, y, month, day);
      if (cand.getTime() <= start.getTime()) {
        y += interval;
        cand = atDay(start, y, month, day);
      }
      next = cand;
      break;
    }

    default:
      return null;
  }

  if (!next) return null;
  if (rule.endsAt) {
    const end = new Date(rule.endsAt);
    if (!Number.isNaN(end.getTime()) && next.getTime() > end.getTime()) return null;
  }
  return next;
}

/**
 * How many Sunday-based week boundaries separate `a` and `b` (b after a).
 * Used to enforce weekly `interval` when byWeekday is set.
 */
function weekIndexDelta(a: Date, b: Date): number {
  const startOfWeek = (d: Date) => {
    const day = d.getUTCDay();
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return base - day * 24 * 60 * 60 * 1000;
  };
  const wa = startOfWeek(a);
  const wb = startOfWeek(b);
  return Math.round((wb - wa) / (7 * 24 * 60 * 60 * 1000));
}
