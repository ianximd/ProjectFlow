import { describe, it, expect } from 'vitest';
import { compile } from '../compiler.js';
import { buildCatalog } from '../field-catalog.js';
import type { CustomField } from '@projectflow/types';

const cat = buildCatalog([
  { id: 'f1', type: 'number', name: 'Est', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 0, config: null },
  { id: 'f2', type: 'dropdown', name: 'Stage', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 1, config: null },
] as unknown as CustomField[]);

const base = { workspaceId: 'WS', scope: { scopeType: 'SPACE' as const, scopePath: '/SP/' }, catalog: cat };

it('always injects tenant + soft-delete + scope predicate', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [] }, sort: [] });
  expect(r.whereSql).toContain('t.WorkspaceId = @ws');
  expect(r.whereSql).toContain('t.DeletedAt IS NULL');
  expect(r.whereSql).toContain('t.ListPath LIKE @scopePrefix');
  expect(r.params.ws).toBe('WS');
  expect(r.params.scopePrefix).toBe('/SP/%');
});

it('EVERYTHING scope omits the path predicate but keeps workspace bound', () => {
  const r = compile({ workspaceId: 'WS', scope: { scopeType: 'EVERYTHING', scopePath: null }, catalog: cat, filter: { conjunction: 'AND', rules: [] }, sort: [] });
  expect(r.whereSql).toContain('t.WorkspaceId = @ws');
  expect(r.whereSql).not.toContain('ListPath');
});

it('compiles a built-in column equality with a bound parameter', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'status' }, op: '=', value: 'DONE' }] }, sort: [] });
  expect(r.whereSql).toMatch(/t\.Status = @p\d+/);
  expect(Object.values(r.params)).toContain('DONE');
});

it('compiles a join-backed assignee filter as EXISTS', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'assignee' }, op: '=', value: 'U1' }] }, sort: [] });
  expect(r.whereSql).toContain('EXISTS (SELECT 1 FROM TaskAssignees a');
  expect(Object.values(r.params)).toContain('U1');
});

it('compiles a custom number field with CAST(... AS FLOAT) over array-wrapped JSON_VALUE', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [{ field: { kind: 'custom', key: 'f1' }, op: '>=', value: 3 }] }, sort: [] });
  expect(r.whereSql).toContain('TaskCustomFieldValues v');
  expect(r.whereSql).toContain("JSON_VALUE('[' + v.Value + ']', '$[0]')");
  expect(r.whereSql).toContain('AS FLOAT)');
});

it('compiles custom is_empty via emptiness sentinels (no JSON_VALUE on bare scalar)', () => {
  const r = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'custom', key: 'f1' }, op: 'is_empty' }] } });
  expect(r.whereSql).toContain("v.Value NOT IN ('', 'null', '\"\"', '[]')");
  expect(r.whereSql).toMatch(/NOT EXISTS/);
  expect(r.whereSql).not.toContain('JSON_VALUE');
});

it('compiles custom is_not_empty via emptiness sentinels', () => {
  const r = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'custom', key: 'f1' }, op: 'is_not_empty' }] } });
  expect(r.whereSql).toContain("v.Value NOT IN ('', 'null', '\"\"', '[]')");
  expect(r.whereSql).not.toMatch(/NOT EXISTS/);
  expect(r.whereSql).not.toContain('JSON_VALUE');
});

it('compiles nested AND/OR groups', () => {
  const r = compile({ ...base, sort: [], filter: {
    conjunction: 'AND',
    rules: [
      { field: { kind: 'builtin', key: 'status' }, op: '=', value: 'OPEN' },
      { conjunction: 'OR', rules: [
        { field: { kind: 'builtin', key: 'priority' }, op: '=', value: 'HIGH' },
        { field: { kind: 'builtin', key: 'priority' }, op: '=', value: 'URGENT' },
      ] },
    ],
  } });
  expect(r.whereSql).toMatch(/\(.*OR.*\)/s);
});

it('compiles IN with multiple params', () => {
  const r = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'status' }, op: 'in', value: ['A', 'B'] }] } });
  expect(r.whereSql).toMatch(/t\.Status IN \(@p\d+, @p\d+\)/);
});

it('compiles is_empty for a scalar column', () => {
  const r = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'dueDate' }, op: 'is_empty' }] } });
  expect(r.whereSql).toContain('t.DueDate IS NULL');
});

it('compiles multi-key sort over built-in + custom and reports custom joins', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [] }, sort: [
    { field: { kind: 'builtin', key: 'priority' }, dir: 'DESC' },
    { field: { kind: 'custom', key: 'f1' }, dir: 'ASC' },
  ] });
  expect(r.orderSql).toContain('t.Priority DESC');
  expect(r.orderSql).toContain('ASC');
  expect(r.customSortJoins).toEqual([{ alias: 'cfv_f1', fieldId: 'f1' }]);
});

it('rejects an invalid operator for the field type', () => {
  expect(() => compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'status' }, op: '>', value: 'x' }] } })).toThrow();
});

it('defaults sort to position ASC when none given', () => {
  const r = compile({ ...base, filter: { conjunction: 'AND', rules: [] }, sort: [] });
  expect(r.orderSql).toContain('t.Position ASC');
});

it('sanitizes custom-sort alias for GUID field ids (no hyphens in SQL identifier)', () => {
  const guid = 'a1b2c3d4-1111-2222-3333-444455556666';
  const guidCat = buildCatalog([
    { id: guid, type: 'number', name: 'X', workspaceId: 'w', scopeType: 'SPACE', scopeId: 's', required: false, position: 0, config: null },
  ] as unknown as CustomField[]);
  const r = compile({
    workspaceId: 'WS',
    scope: { scopeType: 'SPACE', scopePath: '/SP/' },
    catalog: guidCat,
    filter: { conjunction: 'AND', rules: [] },
    sort: [{ field: { kind: 'custom', key: guid }, dir: 'ASC' }],
  });
  expect(r.customSortJoins[0].alias).toBe('cfv_' + guid.replace(/-/g, ''));
  expect(r.customSortJoins[0].alias).not.toMatch(/-/);
  expect(r.customSortJoins[0].fieldId).toBe(guid); // full GUID preserved for binding
  expect(r.orderSql).not.toMatch(/-/); // ORDER BY identifier has no hyphen
  expect(r.orderSql).toContain(`cfv_${guid.replace(/-/g, '')}.Value`);
});

it('compiles join-backed is_empty / is_not_empty as bare EXISTS (no user predicate)', () => {
  const empty = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'assignee' }, op: 'is_empty' }] } });
  expect(empty.whereSql).toContain('NOT EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId = t.Id)');
  const notEmpty = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [{ field: { kind: 'builtin', key: 'assignee' }, op: 'is_not_empty' }] } });
  expect(notEmpty.whereSql).toContain('EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId = t.Id)');
  expect(notEmpty.whereSql).not.toMatch(/UserId =\s*@/); // bare existence, no user-id param
});

it('compiles not_in for a join-backed field as ANDed NOT EXISTS with each value bound', () => {
  const r = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [
    { field: { kind: 'builtin', key: 'assignee' }, op: 'not_in', value: ['U1', 'U2'] } ] } });
  expect(r.whereSql).toMatch(/NOT EXISTS[\s\S]*UserId[\s\S]*AND[\s\S]*NOT EXISTS[\s\S]*UserId/);
  expect(Object.values(r.params)).toContain('U1');
  expect(Object.values(r.params)).toContain('U2');
});

it('rejects an empty in array', () => {
  expect(() => compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [
    { field: { kind: 'builtin', key: 'status' }, op: 'in', value: [] } ] } })).toThrow();
});

it('escapes LIKE metacharacters in contains values', () => {
  const r = compile({ ...base, sort: [], filter: { conjunction: 'AND', rules: [
    { field: { kind: 'builtin', key: 'title' }, op: 'contains', value: '50%' } ] } });
  expect(Object.values(r.params).some((v) => v === '%50[%]%')).toBe(true);
});
