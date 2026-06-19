import { it, expect, describe } from 'vitest';
import { chunkText } from '../retrieval/chunk.js';

describe('chunkText', () => {
  it('returns [] for empty string', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns [] for whitespace-only string', () => {
    expect(chunkText('   \n\t  ')).toEqual([]);
  });

  it('splits a ~2000-word text into multiple chunks', () => {
    // Generate ~2000 words
    const word = 'lorem';
    const text = Array.from({ length: 2000 }, () => word).join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('each chunk has tokenCount <= 450', () => {
    const word = 'ipsum';
    const text = Array.from({ length: 2000 }, () => word).join(' ');
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(450);
    }
  });

  it('seq numbers are contiguous starting from 0', () => {
    const word = 'dolor';
    const text = Array.from({ length: 2000 }, () => word).join(' ');
    const chunks = chunkText(text);
    chunks.forEach((chunk, idx) => {
      expect(chunk.seq).toBe(idx);
    });
  });

  it('chunk content is non-empty for non-empty input', () => {
    const chunks = chunkText('hello world test');
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });
});
