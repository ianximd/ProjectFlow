import type { FormFieldMapping } from '@projectflow/types';

/** Native task columns a form answer may target. */
export interface MappedTaskFields {
  title?:       string;
  description?: string;
  priority?:    string;
}

export interface MappedCustomFieldValue {
  fieldId: string;
  value:   unknown;
}

export interface MappedTask {
  taskFields:        Required<Pick<MappedTaskFields, 'title'>> & MappedTaskFields;
  customFieldValues: MappedCustomFieldValue[];
}

const NATIVE_TARGETS = new Set(['title', 'description', 'priority']);

/**
 * Split form answers into native task fields and custom-field id/value pairs,
 * per the form's FieldMapping. Unmapped answers and null/undefined values are
 * dropped. Title always resolves (placeholder fallback) so the created task is
 * never untitled.
 */
export function mapAnswersToTask(
  mapping: FormFieldMapping,
  answers: Record<string, unknown>,
): MappedTask {
  const taskFields: MappedTaskFields = {};
  const customFieldValues: MappedCustomFieldValue[] = [];

  for (const [answerKey, value] of Object.entries(answers)) {
    if (value == null) continue;
    const target = mapping[answerKey];
    if (!target) continue;
    if (target.kind === 'task') {
      if (NATIVE_TARGETS.has(target.target)) {
        (taskFields as Record<string, unknown>)[target.target] = value;
      }
    } else {
      customFieldValues.push({ fieldId: target.target, value });
    }
  }

  const title = typeof taskFields.title === 'string' && taskFields.title.trim() !== ''
    ? taskFields.title
    : 'Form submission';

  return { taskFields: { ...taskFields, title }, customFieldValues };
}
