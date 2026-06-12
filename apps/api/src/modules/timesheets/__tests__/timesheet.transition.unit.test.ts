import { describe, it, expect } from 'vitest';
// Adapted from the plan's mixed import/require helper: this package is ESM
// ("type":"module"), so `require` is undefined at runtime. Import the pure
// guard normally — the assertion (throws TimesheetTransitionError on an
// illegal move) is unchanged.
import { canTransition, assertTransition, TimesheetTransitionError } from '../timesheet.service.js';

describe('canTransition', () => {
  it('draft → submitted is allowed', () => { expect(canTransition('draft', 'submitted')).toBe(true); });
  it('rejected → submitted is allowed (re-submit)', () => { expect(canTransition('rejected', 'submitted')).toBe(true); });
  it('submitted → approved is allowed', () => { expect(canTransition('submitted', 'approved')).toBe(true); });
  it('submitted → rejected is allowed', () => { expect(canTransition('submitted', 'rejected')).toBe(true); });
  it('approved → submitted is NOT allowed', () => { expect(canTransition('approved', 'submitted')).toBe(false); });
  it('draft → approved is NOT allowed', () => { expect(canTransition('draft', 'approved')).toBe(false); });

  it('assertTransition throws TimesheetTransitionError on an illegal move', () => {
    expect(() => assertTransition('approved', 'submitted')).toThrow(TimesheetTransitionError);
  });
});
