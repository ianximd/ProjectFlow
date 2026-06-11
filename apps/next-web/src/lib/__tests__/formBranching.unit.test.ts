import { describe, it, expect } from 'vitest';
import { evalVisibility, validateAnswers } from '../formBranching';
import type { FormConfig } from '@projectflow/types';

const config: FormConfig = {
  fields: [
    { key: 'kind',  label: 'Kind',  type: 'select',    required: true,  options: ['bug', 'idea'] },
    { key: 'steps', label: 'Steps', type: 'long_text', required: true },
  ],
  branching: [
    { fieldKey: 'steps', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'bug' } },
  ],
};

describe('client formBranching', () => {
  it('shows steps for a bug and hides it for an idea', () => {
    expect(evalVisibility(config, { kind: 'bug' }).steps).toBe(true);
    expect(evalVisibility(config, { kind: 'idea' }).steps).toBe(false);
  });
  it('does not enforce a hidden required field', () => {
    expect(validateAnswers(config, { kind: 'idea' }).ok).toBe(true);
  });
  it('enforces a visible required field', () => {
    const r = validateAnswers(config, { kind: 'bug' });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('steps');
  });
});
