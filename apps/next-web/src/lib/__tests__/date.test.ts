import { describe, it, expect } from 'vitest';
import { formatShortDate, formatShortDateYear } from '@/lib/date';

describe('date formatters (fixed en-US locale, hydration-safe)', () => {
  // Constructed from local components so the assertion is timezone-independent.
  const d = new Date(2026, 2, 15); // local March 15, 2026

  it('formatShortDate → "Mar 15"', () => {
    expect(formatShortDate(d)).toBe('Mar 15');
  });

  it('formatShortDateYear → "Mar 15, 2026"', () => {
    expect(formatShortDateYear(d)).toBe('Mar 15, 2026');
  });

  // No 'Z' / offset: V8 parses this as LOCAL time, and noon gives a ±12h
  // cushion so the date never shifts across any timezone — keeps CI stable.
  it('formatShortDateYear accepts an ISO string', () => {
    expect(formatShortDateYear('2026-03-15T12:00:00')).toBe('Mar 15, 2026');
  });

  it('formatShortDate accepts an ISO string', () => {
    expect(formatShortDate('2026-03-15T12:00:00')).toBe('Mar 15');
  });
});
