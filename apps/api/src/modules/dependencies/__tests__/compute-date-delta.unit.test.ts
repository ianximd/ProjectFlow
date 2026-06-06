import { describe, it, expect } from 'vitest';
import { computeDateDelta } from '../dependency.service.js';

describe('computeDateDelta', () => {
  it('returns N for an N-day forward due-date shift', () => {
    const before = { dueDate: '2026-06-01' };
    const after = { dueDate: '2026-06-06' };
    expect(computeDateDelta(before, after)).toBe(5);
  });

  it('returns a negative delta for a backward shift', () => {
    const before = { dueDate: '2026-06-10' };
    const after = { dueDate: '2026-06-07' };
    expect(computeDateDelta(before, after)).toBe(-3);
  });

  it('returns 0 when the due date is unchanged', () => {
    const before = { dueDate: '2026-06-06' };
    const after = { dueDate: '2026-06-06' };
    expect(computeDateDelta(before, after)).toBe(0);
  });

  it('returns 0 when the after due date is null', () => {
    const before = { dueDate: '2026-06-06' };
    const after = { dueDate: null };
    expect(computeDateDelta(before, after)).toBe(0);
  });

  it('returns 0 when the before due date is null', () => {
    const before = { dueDate: null };
    const after = { dueDate: '2026-06-06' };
    expect(computeDateDelta(before, after)).toBe(0);
  });

  it('falls back to startDate when neither side has a dueDate', () => {
    const before = { startDate: '2026-06-01', dueDate: null };
    const after = { startDate: '2026-06-04', dueDate: null };
    expect(computeDateDelta(before, after)).toBe(3);
  });

  it('accepts PascalCase rows (SP SELECT *)', () => {
    const before = { DueDate: new Date('2026-06-01T00:00:00Z') };
    const after = { DueDate: new Date('2026-06-08T00:00:00Z') };
    expect(computeDateDelta(before, after)).toBe(7);
  });

  it('returns 0 for null/undefined holders', () => {
    expect(computeDateDelta(null, null)).toBe(0);
    expect(computeDateDelta(undefined, { dueDate: '2026-06-06' })).toBe(0);
  });
});
