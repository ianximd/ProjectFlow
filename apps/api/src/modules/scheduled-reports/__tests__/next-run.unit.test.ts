import { describe, it, expect } from 'vitest';
import { computeNextRun, periodKeyFor } from '../scheduled-report.service.js';

describe('computeNextRun', () => {
  it('advances a daily cadence by interval from the given instant', () => {
    const next = computeNextRun({ freq: 'daily', interval: 1 }, new Date('2026-06-07T09:00:00.000Z'));
    expect(next?.toISOString()).toBe('2026-06-08T09:00:00.000Z');
  });

  it('returns null once the cadence endsAt has passed', () => {
    const next = computeNextRun(
      { freq: 'daily', interval: 1, endsAt: '2026-06-07T12:00:00.000Z' },
      new Date('2026-06-07T09:00:00.000Z'),
    );
    expect(next).toBeNull();
  });
});

describe('periodKeyFor', () => {
  it('is the occurrence ISO timestamp — stable for the same occurrence', () => {
    const occ = new Date('2026-06-08T09:00:00.000Z');
    expect(periodKeyFor(occ)).toBe('2026-06-08T09:00:00.000Z');
    expect(periodKeyFor(occ)).toBe(periodKeyFor(new Date('2026-06-08T09:00:00.000Z')));
  });
});
