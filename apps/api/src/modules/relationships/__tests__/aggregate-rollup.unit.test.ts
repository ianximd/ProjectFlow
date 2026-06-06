import { describe, expect, it } from 'vitest';
import { aggregateRollup } from '../relationship.service.js';

describe('aggregateRollup', () => {
  it('sum adds numeric values', () => {
    expect(aggregateRollup('sum', [1, 2, 3])).toBe(6);
  });

  it('avg averages numeric values', () => {
    expect(aggregateRollup('avg', [2, 4, 6])).toBe(4);
  });

  it('count returns the length (including non-numeric entries)', () => {
    expect(aggregateRollup('count', [1, 'x', null])).toBe(3);
  });

  it('min returns the smallest numeric value', () => {
    expect(aggregateRollup('min', [5, 2, 8])).toBe(2);
  });

  it('max returns the largest numeric value', () => {
    expect(aggregateRollup('max', [5, 2, 8])).toBe(8);
  });

  it('first returns the first value', () => {
    expect(aggregateRollup('first', ['a', 'b', 'c'])).toBe('a');
  });

  it('concat joins non-empty stringified values with ", "', () => {
    expect(aggregateRollup('concat', ['a', '', 'b', null, 'c'])).toBe('a, b, c');
  });

  it('empty set → null for sum/avg/min/max/first/concat', () => {
    expect(aggregateRollup('sum', [])).toBeNull();
    expect(aggregateRollup('avg', [])).toBeNull();
    expect(aggregateRollup('min', [])).toBeNull();
    expect(aggregateRollup('max', [])).toBeNull();
    expect(aggregateRollup('first', [])).toBeNull();
    expect(aggregateRollup('concat', [])).toBeNull();
  });

  it('empty set → 0 for count', () => {
    expect(aggregateRollup('count', [])).toBe(0);
  });

  it('sum coerces numeric strings and ignores non-numeric entries', () => {
    expect(aggregateRollup('sum', [1, '2', 'x', null])).toBe(3);
  });

  it('sum of an all-non-numeric set → null', () => {
    expect(aggregateRollup('sum', ['x', 'y'])).toBeNull();
  });

  it('first returns null when the first value is null/undefined', () => {
    expect(aggregateRollup('first', [null, 'b'])).toBeNull();
  });
});
