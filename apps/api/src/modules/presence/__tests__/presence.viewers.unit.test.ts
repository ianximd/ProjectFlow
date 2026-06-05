import { describe, it, expect } from 'vitest';
import { computeActiveViewers, PRESENCE_TTL_MS } from '../presence.viewers.js';

const NOW = 1_000_000;

function entry(o: Partial<{ name: string; avatarUrl: string | null; typing: boolean; lastSeen: number }>) {
  return JSON.stringify({ name: 'X', avatarUrl: null, typing: false, lastSeen: NOW, ...o });
}

describe('computeActiveViewers', () => {
  it('returns viewers seen within the TTL window, dropping stale ones', () => {
    const raw = {
      u1: entry({ name: 'Alice', lastSeen: NOW }),
      u2: entry({ name: 'Bob', lastSeen: NOW - PRESENCE_TTL_MS - 1 }),
      u3: entry({ name: 'Cara', typing: true, lastSeen: NOW - 5_000 }),
    };
    const { viewers, stale } = computeActiveViewers(raw, NOW);
    expect(viewers.map((v) => v.userId).sort()).toEqual(['u1', 'u3']);
    expect(viewers.find((v) => v.userId === 'u3')?.typing).toBe(true);
    expect(stale).toEqual(['u2']);
  });

  it('handles empty + malformed entries', () => {
    const { viewers, stale } = computeActiveViewers({ bad: 'not-json' }, NOW);
    expect(viewers).toEqual([]);
    expect(stale).toEqual(['bad']);
  });
});
