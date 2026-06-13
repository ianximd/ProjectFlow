import { describe, it, expect } from 'vitest';
import { resolveCardRenderer } from '../card-registry';
import type { CardType } from '@projectflow/types';

describe('card-registry', () => {
  const types: CardType[] = ['task_list', 'calculation', 'bar', 'line', 'pie', 'time_tracked', 'goal'];
  it('resolves a renderer for every wave-1 card type', () => {
    for (const t of types) expect(resolveCardRenderer(t)).toBeTypeOf('function');
  });
  it('returns a fallback renderer for an unknown type (forward-compat with 9b)', () => {
    expect(resolveCardRenderer('battery' as CardType)).toBeTypeOf('function');
  });
});
