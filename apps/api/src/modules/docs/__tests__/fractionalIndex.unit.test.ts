import { describe, it, expect } from 'vitest';
import { positionBetween, FIRST_POSITION } from '../fractionalIndex.js';

describe('positionBetween', () => {
  it('returns the midpoint between two positions', () => {
    expect(positionBetween(0, 2)).toBe(1);
    expect(positionBetween(1, 2)).toBe(1.5);
  });

  it('appends after the last sibling (no upper bound)', () => {
    expect(positionBetween(4, null)).toBe(5);   // last + 1
  });

  it('prepends before the first sibling (no lower bound)', () => {
    expect(positionBetween(null, 2)).toBe(1);    // first / 2
    expect(positionBetween(null, 1)).toBe(0.5);
  });

  it('returns FIRST_POSITION for an empty sibling list', () => {
    expect(positionBetween(null, null)).toBe(FIRST_POSITION);
  });

  it('never returns a value equal to either bound', () => {
    const p = positionBetween(1, 1.0000001);
    expect(p).toBeGreaterThan(1);
    expect(p).toBeLessThan(1.0000001);
  });
});
