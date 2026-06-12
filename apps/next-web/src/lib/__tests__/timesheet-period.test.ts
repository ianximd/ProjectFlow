import { describe, it, expect } from 'vitest';
import { currentWeekPeriod, weekPeriodOf, shiftWeekPeriod } from '@/lib/timesheet-period';

// A timesheet period is a Monday→Sunday week. 2026-06-01 is a Monday (the API
// integration + e2e seed the 2026-06-01..2026-06-07 week), which anchors these.
describe('timesheet-period (Monday→Sunday week math)', () => {
  describe('weekPeriodOf', () => {
    it('a Monday maps to its own week', () => {
      expect(weekPeriodOf('2026-06-08')).toEqual({ periodStart: '2026-06-08', periodEnd: '2026-06-14' });
    });

    it('a mid-week day maps back to that Monday', () => {
      expect(weekPeriodOf('2026-06-12')).toEqual({ periodStart: '2026-06-08', periodEnd: '2026-06-14' });
    });

    it('a Sunday stays in the week it closes', () => {
      expect(weekPeriodOf('2026-06-14')).toEqual({ periodStart: '2026-06-08', periodEnd: '2026-06-14' });
    });

    it('the next Monday starts a new week', () => {
      expect(weekPeriodOf('2026-06-15')).toEqual({ periodStart: '2026-06-15', periodEnd: '2026-06-21' });
    });

    it('rolls across a month and year boundary', () => {
      // 2027-01-01 is a Friday → week is Mon 2026-12-28 .. Sun 2027-01-03.
      expect(weekPeriodOf('2027-01-01')).toEqual({ periodStart: '2026-12-28', periodEnd: '2027-01-03' });
    });
  });

  describe('currentWeekPeriod', () => {
    it('derives the week from the given local date', () => {
      // Local Friday, June 12 2026 at 09:00.
      expect(currentWeekPeriod(new Date(2026, 5, 12, 9, 0))).toEqual({
        periodStart: '2026-06-08',
        periodEnd:   '2026-06-14',
      });
    });
  });

  describe('shiftWeekPeriod', () => {
    const base = { periodStart: '2026-06-08', periodEnd: '2026-06-14' };

    it('steps back one week', () => {
      expect(shiftWeekPeriod(base, -1)).toEqual({ periodStart: '2026-06-01', periodEnd: '2026-06-07' });
    });

    it('steps forward one week', () => {
      expect(shiftWeekPeriod(base, 1)).toEqual({ periodStart: '2026-06-15', periodEnd: '2026-06-21' });
    });

    it('steps multiple weeks across a month boundary', () => {
      expect(shiftWeekPeriod(base, -2)).toEqual({ periodStart: '2026-05-25', periodEnd: '2026-05-31' });
    });
  });
});
