import { describe, expect, it } from 'vitest';
import {
  ZOOM_CFG, addDays, buildSlots, dateToPx, barGeometry, computeRange,
} from './geometry';

// Local-midnight date builder so the tests are timezone-stable.
const d = (s: string) => {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y!, m! - 1, day!);
};

describe('buildSlots', () => {
  it('week columns start on the Monday on/before rangeStart', () => {
    // 2026-05-13 is a Wednesday.
    const slots = buildSlots('week', d('2026-05-13'), d('2026-06-10'));
    expect(slots[0]!.getDay()).toBe(1); // Monday
    expect(slots[0]!.getTime()).toBe(d('2026-05-11').getTime());
  });

  it('month columns start on the first of each month', () => {
    const slots = buildSlots('month', d('2026-01-10'), d('2026-04-05'));
    expect(slots.map((s) => s.getDate())).toEqual(slots.map(() => 1));
  });
});

describe('dateToPx alignment', () => {
  // Regression: bars used to be positioned relative to rangeStart while the
  // grid columns were positioned relative to slots[0]. In week/month zoom
  // those origins differ (rangeStart is rarely a Monday / 1st), so bars and
  // the today-line floated up to 6 days (week) or a whole column (month) away
  // from their date label.
  it('places a week-slot date exactly on its column', () => {
    const { colPx, unitDays } = ZOOM_CFG.week;
    const slots = buildSlots('week', d('2026-05-13'), d('2026-06-10'));
    expect(dateToPx(slots[2]!, slots, colPx, unitDays)).toBeCloseTo(2 * colPx, 5);
  });

  it('keeps every month column aligned despite unequal month lengths', () => {
    const { colPx, unitDays } = ZOOM_CFG.month;
    const slots = buildSlots('month', d('2026-01-10'), d('2026-12-20'));
    slots.forEach((s, i) => {
      expect(dateToPx(s, slots, colPx, unitDays)).toBeCloseTo(i * colPx, 5);
    });
  });

  it('interpolates within a month proportionally to the day', () => {
    const { colPx, unitDays } = ZOOM_CFG.month;
    const slots = buildSlots('month', d('2026-01-01'), d('2026-03-31'));
    // Jan has 31 days; Jan 16 is 15/31 through the column.
    const expected = (15 / 31) * colPx;
    expect(dateToPx(d('2026-01-16'), slots, colPx, unitDays)).toBeCloseTo(expected, 3);
  });
});

describe('barGeometry', () => {
  const slots = buildSlots('day', d('2026-05-10'), d('2026-05-31'));
  const { colPx, unitDays } = ZOOM_CFG.day;

  it('covers the due day (inclusive end): a single-day task fills one column', () => {
    const g = barGeometry({ startDate: '2026-05-15', dueDate: '2026-05-15' }, slots, colPx, unitDays)!;
    expect(g.width).toBeCloseTo(colPx, 5); // a full day, not a 0.4-col sliver
  });

  it('spans inclusive days: Mon..Wed renders 3 columns', () => {
    const g = barGeometry({ startDate: '2026-05-18', dueDate: '2026-05-20' }, slots, colPx, unitDays)!;
    expect(g.width).toBeCloseTo(3 * colPx, 5);
  });

  it('uses the single set date when only one of start/due is present', () => {
    const onlyStart = barGeometry({ startDate: '2026-05-15', dueDate: null }, slots, colPx, unitDays)!;
    const onlyDue   = barGeometry({ startDate: null, dueDate: '2026-05-15' }, slots, colPx, unitDays)!;
    expect(onlyStart.left).toBeCloseTo(onlyDue.left, 5);
    expect(onlyStart.width).toBeCloseTo(colPx, 5);
  });

  it('returns null when both dates are missing', () => {
    expect(barGeometry({ startDate: null, dueDate: null }, slots, colPx, unitDays)).toBeNull();
  });
});

describe('computeRange', () => {
  it('pads around the data and always includes today', () => {
    const today = d('2026-05-20');
    const { rangeStart, rangeEnd } = computeRange(
      [{ startDate: '2026-05-18', dueDate: '2026-05-22' }],
      today,
      14,
    );
    expect(rangeStart.getTime()).toBe(addDays(d('2026-05-18'), -14).getTime());
    expect(rangeEnd.getTime()).toBe(addDays(d('2026-05-22'), 14).getTime());
  });

  it('expands the range to keep today on the chart', () => {
    const today = d('2026-05-20');
    const { rangeStart, rangeEnd } = computeRange(
      [{ startDate: '2026-08-01', dueDate: '2026-08-10' }],
      today,
      14,
    );
    expect(rangeStart.getTime()).toBeLessThanOrEqual(today.getTime());
    expect(rangeEnd.getTime()).toBeGreaterThanOrEqual(d('2026-08-10').getTime());
  });
});
