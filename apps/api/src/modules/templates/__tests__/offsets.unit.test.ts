import { describe, it, expect } from 'vitest';
import { dateToOffset, offsetToDate } from '../offsets.js';

const ANCHOR = '2026-06-06T00:00:00.000Z';

describe('templates/offsets', () => {
  describe('dateToOffset', () => {
    it('returns 0 for the anchor day itself', () => {
      expect(dateToOffset('2026-06-06T00:00:00.000Z', ANCHOR)).toBe(0);
    });

    it('returns whole days for a later date', () => {
      expect(dateToOffset('2026-06-09T00:00:00.000Z', ANCHOR)).toBe(3);
    });

    it('returns a negative offset for a date before the anchor', () => {
      expect(dateToOffset('2026-06-01T00:00:00.000Z', ANCHOR)).toBe(-5);
    });

    it('floors to whole UTC days regardless of time-of-day', () => {
      // 14:30 on day +2 still resolves to +2 whole days.
      expect(dateToOffset('2026-06-08T14:30:00.000Z', ANCHOR)).toBe(2);
      // 23:59 on the anchor day is still offset 0.
      expect(dateToOffset('2026-06-06T23:59:59.000Z', ANCHOR)).toBe(0);
    });

    it('crosses a month boundary correctly', () => {
      // 2026-07-06 is exactly 30 days after 2026-06-06.
      expect(dateToOffset('2026-07-06T00:00:00.000Z', ANCHOR)).toBe(30);
      // end of month: 2026-06-30 is 24 days after the anchor.
      expect(dateToOffset('2026-06-30T00:00:00.000Z', ANCHOR)).toBe(24);
    });

    it('accepts Date objects as well as ISO strings', () => {
      expect(dateToOffset(new Date('2026-06-10T00:00:00.000Z'), new Date(ANCHOR))).toBe(4);
    });

    it('returns null for null/undefined/invalid input', () => {
      expect(dateToOffset(null, ANCHOR)).toBeNull();
      expect(dateToOffset(undefined, ANCHOR)).toBeNull();
      expect(dateToOffset('not-a-date', ANCHOR)).toBeNull();
      expect(dateToOffset('2026-06-09T00:00:00.000Z', null)).toBeNull();
    });
  });

  describe('offsetToDate', () => {
    it('returns the anchor midnight for offset 0', () => {
      expect(offsetToDate(0, ANCHOR)?.toISOString()).toBe('2026-06-06T00:00:00.000Z');
    });

    it('adds whole days for a positive offset', () => {
      expect(offsetToDate(3, ANCHOR)?.toISOString()).toBe('2026-06-09T00:00:00.000Z');
    });

    it('subtracts days for a negative offset', () => {
      expect(offsetToDate(-5, ANCHOR)?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });

    it('crosses a month boundary', () => {
      expect(offsetToDate(30, ANCHOR)?.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    });

    it('returns null for null/undefined offset or a bad anchor', () => {
      expect(offsetToDate(null, ANCHOR)).toBeNull();
      expect(offsetToDate(undefined, ANCHOR)).toBeNull();
      expect(offsetToDate(3, null)).toBeNull();
      expect(offsetToDate(3, 'not-a-date')).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('dateToOffset -> offsetToDate against a NEW anchor remaps correctly', () => {
      const captureAnchor = '2026-06-06T00:00:00.000Z';
      const due = '2026-06-09T12:00:00.000Z'; // +3 days (time-of-day floored)
      const off = dateToOffset(due, captureAnchor);
      expect(off).toBe(3);

      const newAnchor = '2026-12-01T00:00:00.000Z';
      const remapped = offsetToDate(off, newAnchor);
      expect(remapped?.toISOString()).toBe('2026-12-04T00:00:00.000Z');
    });

    it('round-trips an offset back to itself across the same anchor', () => {
      for (const off of [-365, -30, -1, 0, 1, 7, 30, 90, 366]) {
        const d = offsetToDate(off, ANCHOR);
        expect(dateToOffset(d, ANCHOR)).toBe(off);
      }
    });
  });
});
