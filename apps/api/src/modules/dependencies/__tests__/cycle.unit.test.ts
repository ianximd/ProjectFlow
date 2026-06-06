import { describe, it, expect } from 'vitest';
import { wouldCreateCycle } from '../cycle.js';

// edges: Map<taskId, Set<dependsOn>>  (taskId waits_on dependsOn)
describe('wouldCreateCycle', () => {
  it('rejects self-edge', () => {
    expect(wouldCreateCycle(new Map(), 'a', 'a')).toBe(true);
  });
  it('detects direct cycle A->B when B->A exists', () => {
    const e = new Map([['b', new Set(['a'])]]);       // b waits_on a
    expect(wouldCreateCycle(e, 'a', 'b')).toBe(true);  // adding a waits_on b closes the loop
  });
  it('detects transitive cycle', () => {
    const e = new Map([['b', new Set(['c'])], ['c', new Set(['a'])]]); // b->c->a
    expect(wouldCreateCycle(e, 'a', 'b')).toBe(true);
  });
  it('allows a DAG edge', () => {
    const e = new Map([['a', new Set(['b'])]]);
    expect(wouldCreateCycle(e, 'b', 'c')).toBe(false);
  });
});
