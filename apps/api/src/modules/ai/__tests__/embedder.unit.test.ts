import { it, expect, describe, beforeEach, afterEach } from 'vitest';
import { FakeEmbedder } from '../retrieval/fake.embedder.js';
import { makeEmbedder } from '../retrieval/voyage.embedder.js';

describe('FakeEmbedder', () => {
  it('is deterministic and fixed-dim', async () => {
    const e = new FakeEmbedder();
    const [a] = await e.embed(['hello world']);
    const [b] = await e.embed(['hello world']);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(256);
  });

  it('model name is "fake-1"', () => {
    const e = new FakeEmbedder();
    expect(e.model).toBe('fake-1');
  });

  it('returns L2-normalized vector for non-empty input', async () => {
    const e = new FakeEmbedder();
    const [v] = await e.embed(['normalize me']);
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
  });

  it('returns zero vector for empty-string input', async () => {
    const e = new FakeEmbedder();
    const [v] = await e.embed(['']);
    const allZero = Array.from(v).every((x) => x === 0);
    expect(allZero).toBe(true);
  });

  it('handles multiple texts in one call', async () => {
    const e = new FakeEmbedder();
    const results = await e.embed(['alpha', 'beta', 'gamma']);
    expect(results).toHaveLength(3);
    for (const v of results) expect(v.length).toBe(256);
  });
});

describe('makeEmbedder (factory)', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.VOYAGE_API_KEY;
    delete process.env.VOYAGE_API_KEY;
  });

  afterEach(() => {
    if (saved !== undefined) {
      process.env.VOYAGE_API_KEY = saved;
    } else {
      delete process.env.VOYAGE_API_KEY;
    }
  });

  it('returns a FakeEmbedder when VOYAGE_API_KEY is unset', () => {
    const e = makeEmbedder();
    expect(e).toBeInstanceOf(FakeEmbedder);
  });
});
