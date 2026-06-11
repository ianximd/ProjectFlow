import { describe, it, expect } from 'vitest';
import { mapAnswersToTask } from '../form.mapping.js';
import type { FormFieldMapping } from '@projectflow/types';

const mapping: FormFieldMapping = {
  summary:  { kind: 'task', target: 'title' },
  details:  { kind: 'task', target: 'description' },
  urgency:  { kind: 'task', target: 'priority' },
  effort:   { kind: 'custom_field', target: 'FIELD-EFFORT-ID' },
};

describe('mapAnswersToTask', () => {
  it('splits answers into native task fields vs custom-field id values', () => {
    const out = mapAnswersToTask(mapping, {
      summary: 'Login broken',
      details: 'Steps to repro...',
      urgency: 'HIGH',
      effort:  5,
    });
    expect(out.taskFields).toEqual({ title: 'Login broken', description: 'Steps to repro...', priority: 'HIGH' });
    expect(out.customFieldValues).toEqual([{ fieldId: 'FIELD-EFFORT-ID', value: 5 }]);
  });

  it('drops answers with no mapping entry', () => {
    const out = mapAnswersToTask(mapping, { summary: 'X', extra: 'ignored' });
    expect(out.taskFields).toEqual({ title: 'X' });
    expect(out.customFieldValues).toEqual([]);
  });

  it('falls back to a placeholder title when nothing maps to title', () => {
    const out = mapAnswersToTask({ effort: { kind: 'custom_field', target: 'F1' } }, { effort: 2 });
    expect(out.taskFields.title).toBe('Form submission');
    expect(out.customFieldValues).toEqual([{ fieldId: 'F1', value: 2 }]);
  });

  it('ignores null/undefined answer values', () => {
    const out = mapAnswersToTask(mapping, { summary: 'Y', details: null, effort: undefined });
    expect(out.taskFields).toEqual({ title: 'Y' });
    expect(out.customFieldValues).toEqual([]);
  });
});
