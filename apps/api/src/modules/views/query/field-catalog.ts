import type { CustomField, FieldRef, FilterOperator } from '@projectflow/types';
import { BUILTIN_FIELDS } from './builtin-fields.js';
import { OPERATORS_BY_LOGICAL, fieldRefId, type FieldDescriptor, type LogicalType } from './types.js';

export class ViewQueryError extends Error {
  constructor(message: string) { super(message); this.name = 'ViewQueryError'; }
}

const CUSTOM_TYPE_TO_LOGICAL: Record<string, LogicalType> = {
  text: 'string', text_area: 'string', url: 'string', email: 'string', phone: 'string', dropdown: 'enum',
  number: 'number', currency: 'number', rating: 'number', progress_manual: 'number', progress_auto: 'number',
  date: 'date', checkbox: 'bool', labels: 'array', people: 'array',
};

export interface Catalog {
  resolve(ref: FieldRef): FieldDescriptor;
  assertOperator(ref: FieldRef, op: FilterOperator): void;
}

export function buildCatalog(customFields: CustomField[]): Catalog {
  const customById = new Map<string, FieldDescriptor>();
  for (const f of customFields) {
    const logical = CUSTOM_TYPE_TO_LOGICAL[f.type] ?? 'string';
    customById.set(f.id, { logical, customFieldId: f.id });
  }

  function resolve(ref: FieldRef): FieldDescriptor {
    if (ref.kind === 'builtin') {
      const d = BUILTIN_FIELDS[ref.key];
      if (!d) throw new ViewQueryError(`Unknown built-in field: ${ref.key}`);
      return d;
    }
    const d = customById.get(ref.key);
    if (!d) throw new ViewQueryError(`Unknown custom field: ${ref.key}`);
    return d;
  }

  function assertOperator(ref: FieldRef, op: FilterOperator): void {
    const d = resolve(ref);
    const allowed = OPERATORS_BY_LOGICAL[d.logical];
    if (!allowed.includes(op))
      throw new ViewQueryError(`Operator '${op}' not valid for field ${fieldRefId(ref)} (${d.logical})`);
  }

  return { resolve, assertOperator };
}
