import { describe, it, expect } from 'vitest';
import { elapsedSeconds } from '../rollup.js';

describe('elapsedSeconds', () => {
  it('computes whole seconds between start and end', () => {
    expect(elapsedSeconds('2026-06-07T09:00:00.000Z', '2026-06-07T09:30:00.000Z')).toBe(1800);
  });
  it('floors sub-second remainders', () => {
    expect(elapsedSeconds('2026-06-07T09:00:00.000Z', '2026-06-07T09:00:01.900Z')).toBe(1);
  });
  it('never returns negative for an end before start', () => {
    expect(elapsedSeconds('2026-06-07T09:30:00.000Z', '2026-06-07T09:00:00.000Z')).toBe(0);
  });
});
