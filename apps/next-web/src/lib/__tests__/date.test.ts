import { describe, it, expect } from 'vitest';
import { formatShortDate, formatShortDateYear, formatShortTime, formatShortDateTime, formatDateTime } from '@/lib/date';

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

  // Time assertions use regex/contains (not toBe) because Node's ICU puts a
  // narrow no-break space (U+202F) before AM/PM — exact-string compares are brittle.
  const dt = new Date(2026, 2, 15, 14, 30); // local Mar 15 2026, 2:30 PM

  it('formatShortTime → time only (no date)', () => {
    const s = formatShortTime(dt);
    expect(s).toMatch(/2:30/);
    expect(s).toMatch(/PM/i);
    expect(s).not.toContain('Mar');
  });

  it('formatShortDateTime → date + time, no year', () => {
    const s = formatShortDateTime(dt);
    expect(s).toContain('Mar 15');
    expect(s).toMatch(/2:30/);
    expect(s).not.toContain('2026');
  });

  it('formatDateTime → full date + time with year', () => {
    const s = formatDateTime(dt);
    expect(s).toContain('Mar 15, 2026');
    expect(s).toMatch(/2:30/);
  });
});
