import { describe, it, expect } from 'vitest';
import { canReadDashboard, nextDefaultMutation } from '../card.aggregate.js';

describe('canReadDashboard', () => {
  it('owner always reads their dashboard regardless of visibility', () => {
    expect(canReadDashboard({ ownerId: 'u1', visibility: 'private' }, 'u1')).toBe(true);
  });
  it('non-owner reads shared/protected but NOT private', () => {
    expect(canReadDashboard({ ownerId: 'u1', visibility: 'shared' }, 'u2')).toBe(true);
    expect(canReadDashboard({ ownerId: 'u1', visibility: 'protected' }, 'u2')).toBe(true);
    expect(canReadDashboard({ ownerId: 'u1', visibility: 'private' }, 'u2')).toBe(false);
  });
});

describe('nextDefaultMutation (one-default-per-scope guard, pure preview)', () => {
  it('clears the prior default in the same scope and sets the new one', () => {
    const rows = [
      { id: 'a', scopeType: 'space', scopeId: 's1', isDefault: true },
      { id: 'b', scopeType: 'space', scopeId: 's1', isDefault: false },
      { id: 'c', scopeType: 'space', scopeId: 's2', isDefault: true },
    ];
    const next = nextDefaultMutation(rows as any, 'b');
    expect(next.find((r) => r.id === 'a')!.isDefault).toBe(false);
    expect(next.find((r) => r.id === 'b')!.isDefault).toBe(true);
    expect(next.find((r) => r.id === 'c')!.isDefault).toBe(true);
  });
});
