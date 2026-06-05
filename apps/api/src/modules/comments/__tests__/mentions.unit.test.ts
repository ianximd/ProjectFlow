import { describe, it, expect } from 'vitest';
import { extractMentionUserIds } from '../mentions.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('extractMentionUserIds', () => {
  it('extracts a single mention token', () => {
    expect(extractMentionUserIds(`hi @[Alice](${A})`)).toEqual([A]);
  });

  it('extracts multiple mentions in order', () => {
    expect(extractMentionUserIds(`@[Alice](${A}) and @[Bob](${B})`)).toEqual([A, B]);
  });

  it('dedupes repeated mentions of the same user', () => {
    expect(extractMentionUserIds(`@[Alice](${A}) @[Alice again](${A})`)).toEqual([A]);
  });

  it('ignores malformed tokens (no userid, wrong brackets, non-guid)', () => {
    expect(extractMentionUserIds('@Alice plain text')).toEqual([]);
    expect(extractMentionUserIds('@[Alice]()')).toEqual([]);
    expect(extractMentionUserIds('@[Alice](not-a-guid)')).toEqual([]);
    expect(extractMentionUserIds('@[Alice](123)')).toEqual([]);
  });

  it('returns [] for empty/whitespace bodies', () => {
    expect(extractMentionUserIds('')).toEqual([]);
    expect(extractMentionUserIds('   ')).toEqual([]);
  });

  it('normalizes extracted ids to lowercase for stable dedup', () => {
    const upper = A.toUpperCase();
    expect(extractMentionUserIds(`@[Alice](${upper}) @[Alice](${A})`)).toEqual([A]);
  });
});
