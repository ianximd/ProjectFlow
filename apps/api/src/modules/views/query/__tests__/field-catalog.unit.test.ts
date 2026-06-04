import { describe, it, expect } from 'vitest';
import { buildCatalog, ViewQueryError } from '../field-catalog.js';
import type { CustomField } from '@projectflow/types';

const customFields = [
  { id: 'f1', type: 'number', name: 'Est', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 0, config: null },
  { id: 'f2', type: 'dropdown', name: 'Stage', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 1, config: null },
] as unknown as CustomField[];

describe('buildCatalog', () => {
  it('resolves a built-in field', () => {
    const d = buildCatalog(customFields).resolve({ kind: 'builtin', key: 'status' });
    expect(d.logical).toBe('enum');
    expect(d.column).toBe('Status');
  });

  it('resolves a custom field with its logical type', () => {
    const d = buildCatalog(customFields).resolve({ kind: 'custom', key: 'f1' });
    expect(d.logical).toBe('number');
    expect(d.customFieldId).toBe('f1');
  });

  it('rejects unknown built-in field', () => {
    expect(() => buildCatalog(customFields).resolve({ kind: 'builtin', key: 'nope' })).toThrow(ViewQueryError);
  });

  it('rejects unknown custom field id', () => {
    expect(() => buildCatalog(customFields).resolve({ kind: 'custom', key: 'ghost' })).toThrow(ViewQueryError);
  });

  it('validates operator against field logical type', () => {
    const cat = buildCatalog(customFields);
    expect(() => cat.assertOperator({ kind: 'builtin', key: 'status' }, '>')).toThrow(ViewQueryError);
    expect(() => cat.assertOperator({ kind: 'builtin', key: 'dueDate' }, '>')).not.toThrow();
  });
});
