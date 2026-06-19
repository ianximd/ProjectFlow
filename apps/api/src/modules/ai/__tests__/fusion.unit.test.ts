import { it, expect, describe } from 'vitest';
import { reciprocalRankFusion } from '../retrieval/fusion.js';

describe('reciprocalRankFusion', () => {
  it('fuses two ranked id-lists, rewarding agreement', () => {
    // 'a' is rank-0 in both lists → highest combined score.
    // 'b' is rank-1 in list1 and rank-2 in list2.
    // 'd' appears only in list2.
    const fused = reciprocalRankFusion([['a', 'b', 'c'], ['a', 'd', 'b']], 60);
    expect(fused[0]).toBe('a'); // top of both lists → wins convincingly
    expect(fused).toContain('d');
  });

  it('items appearing in only one list are still included', () => {
    const fused = reciprocalRankFusion([['x', 'y'], ['z']], 60);
    expect(fused).toContain('x');
    expect(fused).toContain('y');
    expect(fused).toContain('z');
  });

  it('uses default k=60 when omitted', () => {
    const fused = reciprocalRankFusion([['a', 'b'], ['b', 'a']]);
    // 'a' and 'b' both appear twice; scores are symmetric so either could be first.
    // Just verify both are present and result has length 2.
    expect(fused.length).toBe(2);
    expect(fused).toContain('a');
    expect(fused).toContain('b');
  });

  it('returns single list unchanged in order', () => {
    const fused = reciprocalRankFusion([['c', 'b', 'a']], 60);
    expect(fused).toEqual(['c', 'b', 'a']);
  });
});
