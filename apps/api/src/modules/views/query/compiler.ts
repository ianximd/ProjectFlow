import type { FilterGroup, FilterRule, SortKey, ViewScopeType, FieldRef, FilterOperator } from '@projectflow/types';
import { ViewQueryError, type Catalog } from './field-catalog.js';
import type { FieldDescriptor } from './types.js';

export interface CompileScope { scopeType: ViewScopeType; scopePath: string | null }
export interface CompileInput {
  workspaceId: string;
  scope: CompileScope;
  catalog: Catalog;
  filter: FilterGroup;
  sort: SortKey[];
  meUserId?: string;
}
export interface CompiledQuery {
  whereSql: string;
  orderSql: string;
  params: Record<string, unknown>;
  customSortJoins: Array<{ alias: string; fieldId: string }>;
}

type Bind = (v: unknown) => string;

/** Comparison operators that map 1:1 to a SQL binary operator. */
const SQL_OP: Record<string, string> = { '=': '=', '!=': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=' };

export function compile(input: CompileInput): CompiledQuery {
  const params: Record<string, unknown> = { ws: input.workspaceId };
  let pi = 0;
  const bind: Bind = (v) => { const k = `p${pi++}`; params[k] = v; return `@${k}`; };

  // Mandatory predicates — tenant isolation + soft-delete + scope. These use ONLY
  // fixed identifiers and bound params (@ws / @scopePrefix); no user input is interpolated.
  const baseParts: string[] = ['t.WorkspaceId = @ws', 't.DeletedAt IS NULL'];
  if (input.scope.scopeType !== 'EVERYTHING') {
    if (!input.scope.scopePath) throw new ViewQueryError('scopePath required for non-EVERYTHING scope');
    params.scopePrefix = `${input.scope.scopePath}%`;
    baseParts.push('t.ListPath LIKE @scopePrefix');
  }
  if (input.meUserId)
    baseParts.push(`EXISTS (SELECT 1 FROM TaskAssignees a WHERE a.TaskId = t.Id AND a.UserId = ${bind(input.meUserId)})`);

  const userWhere = compileGroup(input.filter, input.catalog, bind);
  const whereSql = userWhere ? `${baseParts.join(' AND ')} AND ${userWhere}` : baseParts.join(' AND ');

  const { orderSql, joins } = compileSort(input.sort, input.catalog);
  return { whereSql, orderSql, params, customSortJoins: joins };
}

function compileGroup(group: FilterGroup, cat: Catalog, bind: Bind): string {
  if (!group.rules.length) return '';
  const parts = group.rules
    .map((r) => ('conjunction' in r ? wrap(compileGroup(r, cat, bind)) : compileRule(r, cat, bind)))
    .filter(Boolean);
  if (!parts.length) return '';
  return parts.join(` ${group.conjunction} `);
}

function wrap(s: string): string { return s ? `(${s})` : ''; }

function compileRule(rule: FilterRule, cat: Catalog, bind: Bind): string {
  // Validates op against field logical type — throws ViewQueryError on mismatch.
  cat.assertOperator(rule.field, rule.op);
  const d = cat.resolve(rule.field);
  return rule.field.kind === 'custom' ? compileCustom(d, rule, bind) : compileBuiltin(d, rule, bind);
}

function compileBuiltin(d: FieldDescriptor, rule: FilterRule, bind: Bind): string {
  // Join-backed built-in (assignee / tags / watchers) — membership via EXISTS.
  if (d.exists) {
    switch (rule.op) {
      case 'is_not_empty': return d.existsBare!();
      case 'is_empty':     return `NOT ${d.existsBare!()}`;
      case 'in':     return `(${asNonEmptyArray(rule.value).map((v) => d.exists!(bind(v))).join(' OR ')})`;
      case 'not_in': return `(${asNonEmptyArray(rule.value).map((v) => `NOT ${d.exists!(bind(v))}`).join(' AND ')})`;
      case '!=':     return `NOT ${d.exists!(bind(rule.value))}`;
      default:             return d.exists!(bind(rule.value)); // '=' / 'contains'
    }
  }
  // Scalar column on Tasks `t`. Column identifier comes from the BUILTIN_FIELDS allow-list.
  if (!d.column) throw new ViewQueryError('Built-in field is neither a column nor join-backed');
  return scalarPredicate(`t.${d.column}`, rule.op, rule.value, bind, d.logical === 'string');
}

function compileCustom(d: FieldDescriptor, rule: FilterRule, bind: Bind): string {
  // The custom FieldId GUID is itself bound as a parameter — never interpolated raw.
  const fieldParam = bind(d.customFieldId);
  const inner = (expr: string) =>
    `EXISTS (SELECT 1 FROM TaskCustomFieldValues v WHERE v.TaskId = t.Id AND v.FieldId = ${fieldParam} AND ${expr})`;

  if (rule.op === 'is_empty')
    return `NOT EXISTS (SELECT 1 FROM TaskCustomFieldValues v WHERE v.TaskId = t.Id AND v.FieldId = ${fieldParam} AND JSON_VALUE(v.Value, '$') IS NOT NULL)`;
  if (rule.op === 'is_not_empty')
    return inner(`JSON_VALUE(v.Value, '$') IS NOT NULL`);

  if (d.logical === 'array') {
    if (rule.op === 'in' || rule.op === 'not_in') {
      const ors = asNonEmptyArray(rule.value).map((val) => `EXISTS (SELECT 1 FROM OPENJSON(v.Value) j WHERE j.value = ${bind(val)})`).join(' OR ');
      const clause = inner(`(${ors})`);
      return rule.op === 'not_in' ? `NOT ${clause}` : clause;
    }
    return inner(`EXISTS (SELECT 1 FROM OPENJSON(v.Value) j WHERE j.value = ${bind(rule.value)})`);
  }

  const lhs = scalarLhs(d, `JSON_VALUE(v.Value, '$')`);
  if (rule.op === 'in' || rule.op === 'not_in') {
    const list = asNonEmptyArray(rule.value).map((v) => bind(v)).join(', ');
    const clause = inner(`${lhs} IN (${list})`);
    return rule.op === 'not_in' ? `NOT ${clause}` : clause;
  }
  if (rule.op === 'contains') return inner(`${lhs} LIKE ${bindLike(rule.value, bind)}`);
  return inner(`${lhs} ${SQL_OP[rule.op]} ${bind(coerce(d, rule.value))}`);
}

function scalarPredicate(col: string, op: FilterOperator, value: unknown, bind: Bind, isString: boolean): string {
  if (op === 'is_empty')     return `${col} IS NULL`;
  if (op === 'is_not_empty') return `${col} IS NOT NULL`;
  if (op === 'in' || op === 'not_in') {
    const list = asNonEmptyArray(value).map((v) => bind(v)).join(', ');
    return `${col} ${op === 'in' ? 'IN' : 'NOT IN'} (${list})`;
  }
  if (op === 'contains' && isString) return `${col} LIKE ${bindLike(value, bind)}`;
  return `${col} ${SQL_OP[op]} ${bind(value)}`;
}

function scalarLhs(d: FieldDescriptor, jsonExpr: string): string {
  if (d.logical === 'number') return `CAST(${jsonExpr} AS FLOAT)`;
  if (d.logical === 'date')   return `CAST(${jsonExpr} AS DATETIME2)`;
  return jsonExpr;
}

function coerce(d: FieldDescriptor, value: unknown): unknown {
  if (d.logical === 'bool') return value ? 'true' : 'false';
  return value;
}

function bindLike(value: unknown, bind: Bind): string {
  const escaped = String(value ?? '').replace(/[%_\[]/g, '[$&]'); // SQL Server LIKE metachar escape
  return bind(`%${escaped}%`);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function asNonEmptyArray(value: unknown): unknown[] {
  const arr = Array.isArray(value) ? value : [value];
  if (!arr.length) throw new ViewQueryError(`'in'/'not_in' requires at least one value`);
  return arr;
}

function compileSort(sort: SortKey[], cat: Catalog): { orderSql: string; joins: Array<{ alias: string; fieldId: string }> } {
  const keys: SortKey[] = sort.length ? sort : [{ field: { kind: 'builtin', key: 'position' } as FieldRef, dir: 'ASC' }];
  const joins: Array<{ alias: string; fieldId: string }> = [];
  const parts = keys.map((k) => {
    const d = cat.resolve(k.field);
    const dir = k.dir === 'DESC' ? 'DESC' : 'ASC';
    if (k.field.kind === 'custom') {
      const alias = `cfv_${k.field.key.replace(/-/g, '')}`;
      joins.push({ alias, fieldId: d.customFieldId! });
      const lhs = d.logical === 'number' ? `CAST(${alias}.Value AS FLOAT)`
                : d.logical === 'date'   ? `CAST(${alias}.Value AS DATETIME2)`
                : `${alias}.Value`;
      return `${lhs} ${dir}`;
    }
    if (!d.column) throw new ViewQueryError(`Field ${k.field.key} is not sortable`);
    return `t.${d.column} ${dir}`;
  });
  return { orderSql: parts.join(', '), joins };
}
