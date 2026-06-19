import { it, expect, describe } from 'vitest';
import { buildAskPrompt, parseCitations } from '../qa/qa.prompt.js';

const chunks = [
  { id: 'c1', objectType: 'task', objectId: 't1', scopeType: 'LIST', scopeId: 'l1', content: 'Launch slips to Q3' },
  { id: 'c2', objectType: 'doc', objectId: 'd1', scopeType: 'LIST', scopeId: 'l1', content: 'Budget approved' },
];

describe('buildAskPrompt', () => {
  it('numbers sources [1..n] and parses cited indices back to objects', () => {
    const { prompt, sources } = buildAskPrompt('what is at risk?', chunks);
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('[2]');
    expect(prompt).toContain('Launch slips to Q3');
    expect(prompt).toContain('Question: what is at risk?');
    const cites = parseCitations('Launch is at risk [1].', sources);
    expect(cites).toEqual([{ objectType: 'task', objectId: 't1' }]);
  });

  it('returns empty sources + a well-formed prompt for no chunks', () => {
    const { prompt, sources } = buildAskPrompt('anything?', []);
    expect(sources).toEqual([]);
    expect(prompt).toContain('Question: anything?');
  });
});

describe('parseCitations', () => {
  const { sources } = buildAskPrompt('q', chunks);

  it('dedupes repeated citations', () => {
    const cites = parseCitations('See [1] and again [1] plus [2].', sources);
    expect(cites).toEqual([
      { objectType: 'task', objectId: 't1' },
      { objectType: 'doc', objectId: 'd1' },
    ]);
  });

  it('returns [] when the answer cites nothing', () => {
    expect(parseCitations('No sources had the answer.', sources)).toEqual([]);
  });

  it('ignores out-of-range citation indices', () => {
    const cites = parseCitations('Per [9] this is unknown, but [1] is real.', sources);
    expect(cites).toEqual([{ objectType: 'task', objectId: 't1' }]);
  });
});
