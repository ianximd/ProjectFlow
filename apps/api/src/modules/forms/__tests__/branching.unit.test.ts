import { describe, it, expect } from 'vitest';
import { evalVisibility, validateAnswers } from '../form.branching.js';
import type { FormConfig } from '@projectflow/types';

const config: FormConfig = {
  fields: [
    { key: 'kind',    label: 'Kind',    type: 'select',     required: true,  options: ['bug', 'idea'] },
    { key: 'steps',   label: 'Steps',   type: 'long_text',  required: true },
    { key: 'votes',   label: 'Votes',   type: 'number',     required: false },
  ],
  branching: [
    // "steps" only shows for bug reports; "votes" only for ideas.
    { fieldKey: 'steps', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'bug'  } },
    { fieldKey: 'votes', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'idea' } },
  ],
};

describe('evalVisibility', () => {
  it('shows a field whose show-rule matches and hides it otherwise', () => {
    const bug  = evalVisibility(config, { kind: 'bug' });
    expect(bug.steps).toBe(true);
    expect(bug.votes).toBe(false);

    const idea = evalVisibility(config, { kind: 'idea' });
    expect(idea.steps).toBe(false);
    expect(idea.votes).toBe(true);
  });

  it('treats an unruled field as always visible', () => {
    expect(evalVisibility(config, {}).kind).toBe(true);
  });

  it('hides via an explicit hide-rule when its condition matches', () => {
    const cfg: FormConfig = {
      fields: [
        { key: 'a', label: 'A', type: 'checkbox', required: false },
        { key: 'b', label: 'B', type: 'short_text', required: false },
      ],
      branching: [{ fieldKey: 'b', action: 'hide', when: { fieldKey: 'a', op: 'equals', value: 'true' } }],
    };
    expect(evalVisibility(cfg, { a: 'true' }).b).toBe(false);
    expect(evalVisibility(cfg, { a: 'false' }).b).toBe(true);
  });
});

describe('validateAnswers', () => {
  it('passes when every VISIBLE required field is filled', () => {
    const r = validateAnswers(config, { kind: 'bug', steps: 'open app, crash' });
    expect(r.ok).toBe(true);
  });

  it('does NOT enforce a required field that branching hid', () => {
    // "steps" is required but hidden for ideas → not enforced.
    const r = validateAnswers(config, { kind: 'idea', votes: 3 });
    expect(r.ok).toBe(true);
  });

  it('fails when a visible required field is empty', () => {
    const r = validateAnswers(config, { kind: 'bug' });   // steps visible + required + missing
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('steps');
  });

  it('rejects an unknown answer key', () => {
    const r = validateAnswers(config, { kind: 'bug', steps: 'x', bogus: 1 });
    expect(r.ok).toBe(false);
    expect(r.unknown).toContain('bogus');
  });
});
