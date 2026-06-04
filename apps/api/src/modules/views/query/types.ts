import type { FilterOperator, FieldRef } from '@projectflow/types';

export type LogicalType = 'string' | 'number' | 'date' | 'enum' | 'user' | 'bool' | 'array';

/** How a field maps to SQL inside the compiler. */
export interface FieldDescriptor {
  logical: LogicalType;
  /** built-in: a column on Tasks `t` (e.g. 'Status'); join-backed fields use `exists` instead */
  column?: string;
  /** join-backed built-in (assignee/tags/watchers): returns an EXISTS clause given a param placeholder */
  exists?: (param: string) => string;
  /** custom field id (GUID) when the FieldRef.kind === 'custom' */
  customFieldId?: string;
}

export const OPERATORS_BY_LOGICAL: Record<LogicalType, FilterOperator[]> = {
  string: ['=', '!=', 'contains', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  number: ['=', '!=', '>', '>=', '<', '<=', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  date:   ['=', '!=', '>', '>=', '<', '<=', 'is_empty', 'is_not_empty'],
  enum:   ['=', '!=', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  user:   ['=', '!=', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  bool:   ['=', '!='],
  array:  ['contains', 'in', 'not_in', 'is_empty', 'is_not_empty'],
};

export function fieldRefId(ref: FieldRef): string {
  return `${ref.kind}:${ref.key}`;
}
