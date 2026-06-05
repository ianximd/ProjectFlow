import { describe, it, expect } from 'vitest';
import { parseMentionSegments } from '../mentions';

const A = '11111111-1111-1111-1111-111111111111';

describe('parseMentionSegments', () => {
  it('splits body into text + mention segments', () => {
    expect(parseMentionSegments(`hi @[Alice](${A})!`)).toEqual([
      { kind: 'text', value: 'hi ' },
      { kind: 'mention', name: 'Alice', userId: A },
      { kind: 'text', value: '!' },
    ]);
  });

  it('returns a single text segment when there are no mentions', () => {
    expect(parseMentionSegments('plain')).toEqual([{ kind: 'text', value: 'plain' }]);
  });
});
