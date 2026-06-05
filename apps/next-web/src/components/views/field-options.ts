// Shared field metadata for the Views Engine UI (table/list columns, group-by,
// sort keys, filter rules). The built-in keys mirror the API's B1 allow-list:
//   status, priority, type, title, storyPoints, dueDate, startDate, createdAt,
//   updatedAt, position, reporter, sprint, assignee, tags, watchers
// Custom fields come from the scope's CustomField[] (key = CustomFields.Id GUID).

import type { CustomField, FieldRef } from '@projectflow/types';
import type { Task } from '@/server/queries/normalize-task';

/** Readable labels for every built-in field key the API accepts. */
export const BUILTIN_FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  status: 'Status',
  priority: 'Priority',
  type: 'Type',
  storyPoints: 'Story Points',
  dueDate: 'Due Date',
  startDate: 'Start Date',
  createdAt: 'Created',
  updatedAt: 'Updated',
  position: 'Position',
  reporter: 'Reporter',
  sprint: 'Sprint',
  assignee: 'Assignee',
  tags: 'Tags',
  watchers: 'Watchers',
};

/** Ordered built-in field keys offered in the builder. */
export const BUILTIN_FIELD_KEYS: string[] = Object.keys(BUILTIN_FIELD_LABELS);

export interface FieldOption {
  ref: FieldRef;
  label: string;
}

/** All selectable fields for a scope: built-ins followed by the scope's custom
 *  fields (sorted by their configured position). */
export function buildFieldOptions(customFields: CustomField[]): FieldOption[] {
  const builtins: FieldOption[] = BUILTIN_FIELD_KEYS.map((key) => ({
    ref: { kind: 'builtin', key },
    label: BUILTIN_FIELD_LABELS[key]!,
  }));
  const custom: FieldOption[] = [...customFields]
    .sort((a, b) => a.position - b.position)
    .map((f) => ({ ref: { kind: 'custom', key: f.id }, label: f.name }));
  return [...builtins, ...custom];
}

/** Human label for a FieldRef (built-in label or the custom field's name). */
export function fieldRefLabel(ref: FieldRef, customFields: CustomField[]): string {
  if (ref.kind === 'builtin') return BUILTIN_FIELD_LABELS[ref.key] ?? ref.key;
  return customFields.find((f) => f.id === ref.key)?.name ?? 'Custom field';
}

/** Stable string token for a FieldRef (for Select values / React keys). */
export function fieldRefToken(ref: FieldRef): string {
  return `${ref.kind}:${ref.key}`;
}

/** Parse a `fieldRefToken` back into a FieldRef. */
export function tokenToFieldRef(token: string): FieldRef {
  const idx = token.indexOf(':');
  const kind = token.slice(0, idx);
  const key = token.slice(idx + 1);
  return { kind: kind === 'custom' ? 'custom' : 'builtin', key };
}

// Built-in keys that map directly onto the normalized `Task` shape. Other built-ins
// (reporter, sprint, assignee, tags, watchers, createdAt, updatedAt) aren't on the
// page's normalized Task projection, so we render a placeholder for those cells.
const TASK_BUILTIN_ACCESSORS: Record<string, (t: Task) => unknown> = {
  title: (t) => t.title,
  status: (t) => t.status,
  priority: (t) => t.priority,
  type: (t) => t.type,
  storyPoints: (t) => t.storyPoints,
  dueDate: (t) => t.dueDate,
  startDate: (t) => t.startDate,
  position: (t) => t.position,
  sprint: (t) => t.sprintId,
};

/** Resolve a FieldRef's value for a given task (used for client-side grouping and
 *  rendering table/list cells). Returns null when a built-in isn't on the
 *  normalized Task projection, or when a custom field has no value for the task. */
export function taskFieldValue(task: Task, ref: FieldRef, _customFields: CustomField[]): unknown {
  if (ref.kind === 'builtin') {
    const accessor = TASK_BUILTIN_ACCESSORS[ref.key];
    return accessor ? accessor(task) : null;
  }
  // Custom field: resolved from the Views projection (ViewRepository.queryTasks),
  // keyed by lowercased FieldId. The ref key can carry either case, so lowercase
  // it to match. Returns null when this task has no value for the field.
  return task.customFieldValues?.[ref.key.toLowerCase()] ?? null;
}
