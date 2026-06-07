import { describe, it, expect } from 'vitest';
import { shouldEnqueue, MAX_DEPTH } from '../automation.bus.js';

describe('shouldEnqueue (loop guard)', () => {
  it('allows a fresh rule at depth 0', () => {
    expect(shouldEnqueue('rule-a', { depth: 0, causationChain: [] })).toEqual({ ok: true });
  });

  it('blocks a rule already in the causation chain (self-retrigger)', () => {
    const r = shouldEnqueue('rule-a', { depth: 1, causationChain: ['rule-a'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('chain');
  });

  it('blocks once depth reaches MAX_DEPTH', () => {
    const r = shouldEnqueue('rule-z', { depth: MAX_DEPTH, causationChain: ['x', 'y'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('depth');
  });

  it('allows a different rule one below the depth cap', () => {
    expect(shouldEnqueue('rule-b', { depth: MAX_DEPTH - 1, causationChain: ['rule-a'] }))
      .toEqual({ ok: true });
  });

  it('MAX_DEPTH defaults to 5', () => {
    expect(MAX_DEPTH).toBe(5);
  });
});
