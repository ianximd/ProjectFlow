import { describe, it, expect } from 'vitest';
import {
  computeNextOccurrence,
  validateRule,
  InvalidRecurrenceRuleError,
  type RecurrenceRuleShape,
} from '../recurrence.js';

// All inputs/outputs use UTC ISO strings so the assertions are timezone-stable.
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('validateRule', () => {
  it('accepts a minimal daily rule', () => {
    expect(validateRule({ freq: 'daily', interval: 1 })).toEqual({
      freq: 'daily', interval: 1,
      byWeekday: undefined, byMonthday: undefined, endsAt: undefined, count: undefined,
    });
  });

  it('rejects a bad freq', () => {
    expect(() => validateRule({ freq: 'hourly', interval: 1 })).toThrow(InvalidRecurrenceRuleError);
  });

  it('rejects interval <= 0', () => {
    expect(() => validateRule({ freq: 'daily', interval: 0 })).toThrow(InvalidRecurrenceRuleError);
    expect(() => validateRule({ freq: 'daily', interval: -2 })).toThrow(InvalidRecurrenceRuleError);
  });

  it('rejects a non-integer interval', () => {
    expect(() => validateRule({ freq: 'daily', interval: 1.5 })).toThrow(InvalidRecurrenceRuleError);
  });

  it('rejects out-of-range byWeekday', () => {
    expect(() => validateRule({ freq: 'weekly', interval: 1, byWeekday: [7] })).toThrow(InvalidRecurrenceRuleError);
    expect(() => validateRule({ freq: 'weekly', interval: 1, byWeekday: [-1] })).toThrow(InvalidRecurrenceRuleError);
  });

  it('rejects out-of-range byMonthday', () => {
    expect(() => validateRule({ freq: 'monthly', interval: 1, byMonthday: 0 })).toThrow(InvalidRecurrenceRuleError);
    expect(() => validateRule({ freq: 'monthly', interval: 1, byMonthday: 32 })).toThrow(InvalidRecurrenceRuleError);
  });

  it('rejects an invalid endsAt', () => {
    expect(() => validateRule({ freq: 'daily', interval: 1, endsAt: 'not-a-date' })).toThrow(InvalidRecurrenceRuleError);
  });

  it('rejects count <= 0', () => {
    expect(() => validateRule({ freq: 'daily', interval: 1, count: 0 })).toThrow(InvalidRecurrenceRuleError);
  });

  it('normalizes an empty byWeekday array to undefined', () => {
    expect(validateRule({ freq: 'weekly', interval: 1, byWeekday: [] }).byWeekday).toBeUndefined();
  });

  it('rejects a non-object rule', () => {
    expect(() => validateRule(null)).toThrow(InvalidRecurrenceRuleError);
    expect(() => validateRule('x')).toThrow(InvalidRecurrenceRuleError);
  });
});

describe('computeNextOccurrence — daily', () => {
  it('adds one day by default', () => {
    const r: RecurrenceRuleShape = { freq: 'daily', interval: 1 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-06-07T09:00:00.000Z');
  });

  it('honors interval > 1', () => {
    const r: RecurrenceRuleShape = { freq: 'daily', interval: 3 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-06-09T09:00:00.000Z');
  });

  it('preserves time-of-day', () => {
    const r: RecurrenceRuleShape = { freq: 'daily', interval: 1 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T23:30:15.500Z'))).toBe('2026-06-07T23:30:15.500Z');
  });
});

describe('computeNextOccurrence — weekly', () => {
  it('adds interval weeks with no byWeekday', () => {
    const r: RecurrenceRuleShape = { freq: 'weekly', interval: 1 };
    // 2026-06-06 is a Saturday → next Saturday.
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-06-13T09:00:00.000Z');
  });

  it('adds 2 weeks when interval=2 and no byWeekday', () => {
    const r: RecurrenceRuleShape = { freq: 'weekly', interval: 2 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-06-20T09:00:00.000Z');
  });

  it('finds the next matching weekday within the same week', () => {
    // 2026-06-01 is a Monday (getUTCDay 1). byWeekday [1,3,5] = Mon/Wed/Fri.
    // Next after Monday is Wednesday 2026-06-03.
    const r: RecurrenceRuleShape = { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] };
    expect(iso(computeNextOccurrence(r, '2026-06-01T08:00:00.000Z'))).toBe('2026-06-03T08:00:00.000Z');
  });

  it('wraps to the next week when no later weekday remains this week', () => {
    // 2026-06-05 is a Friday (getUTCDay 5). byWeekday [1] = Monday only.
    // Next Monday is 2026-06-08.
    const r: RecurrenceRuleShape = { freq: 'weekly', interval: 1, byWeekday: [1] };
    expect(iso(computeNextOccurrence(r, '2026-06-05T08:00:00.000Z'))).toBe('2026-06-08T08:00:00.000Z');
  });

  it('respects interval>1 across the week wrap', () => {
    // From Friday 2026-06-05 with byWeekday [1] (Mon) and interval 2: the Monday
    // in the immediately-next week (1 week ahead) is skipped; the match is the
    // Monday 2 weeks ahead → 2026-06-15.
    const r: RecurrenceRuleShape = { freq: 'weekly', interval: 2, byWeekday: [1] };
    expect(iso(computeNextOccurrence(r, '2026-06-05T08:00:00.000Z'))).toBe('2026-06-15T08:00:00.000Z');
  });

  // ── FIX 4: biweekly (interval=2) + byWeekday active-week semantics ───────────
  // `from` is the PREVIOUS occurrence, so its week is an ACTIVE week. A byWeekday
  // day later in that SAME week (weeksAhead===0) is a valid next occurrence even
  // for interval>1. These tests pin the intended sequence so a future "fix" that
  // rejects weeksAhead===0 (which would break interval=1 same-week-ahead too) is
  // caught. The current code already produces these — KEPT, comment added in src.
  describe('FIX 4 — biweekly Mon/Wed active-week semantics', () => {
    // 2026-06-01 is a Monday, 2026-06-03 Wednesday, 2026-06-15 the Monday 2wk later.
    const biweeklyMonWed: RecurrenceRuleShape = { freq: 'weekly', interval: 2, byWeekday: [1, 3] };

    it('from Mon → Wed of the SAME week (weeksAhead===0 accepted)', () => {
      expect(iso(computeNextOccurrence(biweeklyMonWed, '2026-06-01T08:00:00.000Z')))
        .toBe('2026-06-03T08:00:00.000Z');
    });

    it('from Wed → Mon TWO weeks later (the immediately-next Mon is skipped)', () => {
      expect(iso(computeNextOccurrence(biweeklyMonWed, '2026-06-03T08:00:00.000Z')))
        .toBe('2026-06-15T08:00:00.000Z');
    });

    it('full biweekly chain Mon→Wed→Mon(+2wk)→Wed(+2wk) stays on stride', () => {
      let cur = '2026-06-01T08:00:00.000Z'; // Mon
      cur = iso(computeNextOccurrence(biweeklyMonWed, cur))!;
      expect(cur).toBe('2026-06-03T08:00:00.000Z'); // Wed same week
      cur = iso(computeNextOccurrence(biweeklyMonWed, cur))!;
      expect(cur).toBe('2026-06-15T08:00:00.000Z'); // Mon +2 weeks
      cur = iso(computeNextOccurrence(biweeklyMonWed, cur))!;
      expect(cur).toBe('2026-06-17T08:00:00.000Z'); // Wed same week
    });

    it('interval=1 from Thu byWeekday=[Fri] → Fri SAME week (sanity: weeksAhead===0 path)', () => {
      // 2026-06-04 is a Thursday; Friday is 2026-06-05.
      const r: RecurrenceRuleShape = { freq: 'weekly', interval: 1, byWeekday: [5] };
      expect(iso(computeNextOccurrence(r, '2026-06-04T08:00:00.000Z')))
        .toBe('2026-06-05T08:00:00.000Z');
    });
  });
});

describe('computeNextOccurrence — monthly', () => {
  it('adds one month, same day', () => {
    const r: RecurrenceRuleShape = { freq: 'monthly', interval: 1 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-07-06T09:00:00.000Z');
  });

  it('honors interval months', () => {
    const r: RecurrenceRuleShape = { freq: 'monthly', interval: 3 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-09-06T09:00:00.000Z');
  });

  it('uses byMonthday later in the same month when it is after the from day', () => {
    const r: RecurrenceRuleShape = { freq: 'monthly', interval: 1, byMonthday: 20 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-06-20T09:00:00.000Z');
  });

  it('rolls to next month when byMonthday already passed', () => {
    const r: RecurrenceRuleShape = { freq: 'monthly', interval: 1, byMonthday: 3 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-07-03T09:00:00.000Z');
  });

  it('clamps Jan-31 → Feb-28 in a non-leap year', () => {
    const r: RecurrenceRuleShape = { freq: 'monthly', interval: 1, byMonthday: 31 };
    // From 2027-01-31, next monthly occurrence clamps to Feb 28 (2027 is not a leap year).
    expect(iso(computeNextOccurrence(r, '2027-01-31T09:00:00.000Z'))).toBe('2027-02-28T09:00:00.000Z');
  });

  it('clamps Jan-31 → Feb-29 in a leap year', () => {
    const r: RecurrenceRuleShape = { freq: 'monthly', interval: 1, byMonthday: 31 };
    // 2028 is a leap year.
    expect(iso(computeNextOccurrence(r, '2028-01-31T09:00:00.000Z'))).toBe('2028-02-29T09:00:00.000Z');
  });
});

describe('computeNextOccurrence — yearly', () => {
  it('adds one year, same month/day', () => {
    const r: RecurrenceRuleShape = { freq: 'yearly', interval: 1 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2027-06-06T09:00:00.000Z');
  });

  it('honors interval years', () => {
    const r: RecurrenceRuleShape = { freq: 'yearly', interval: 2 };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2028-06-06T09:00:00.000Z');
  });

  it('clamps Feb-29 → Feb-28 on a non-leap target year', () => {
    const r: RecurrenceRuleShape = { freq: 'yearly', interval: 1 };
    // 2028-02-29 + 1 year → 2029 is not leap → Feb 28.
    expect(iso(computeNextOccurrence(r, '2028-02-29T09:00:00.000Z'))).toBe('2029-02-28T09:00:00.000Z');
  });
});

describe('computeNextOccurrence — endsAt cutoff', () => {
  it('returns null when the next occurrence is past endsAt', () => {
    const r: RecurrenceRuleShape = { freq: 'daily', interval: 1, endsAt: '2026-06-06T23:59:59.000Z' };
    expect(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z')).toBeNull();
  });

  it('returns the occurrence when it is on/before endsAt', () => {
    const r: RecurrenceRuleShape = { freq: 'daily', interval: 1, endsAt: '2026-06-30T00:00:00.000Z' };
    expect(iso(computeNextOccurrence(r, '2026-06-06T09:00:00.000Z'))).toBe('2026-06-07T09:00:00.000Z');
  });
});

describe('computeNextOccurrence — invalid from', () => {
  it('returns null on an unparseable from', () => {
    const r: RecurrenceRuleShape = { freq: 'daily', interval: 1 };
    expect(computeNextOccurrence(r, 'nonsense')).toBeNull();
  });
});
