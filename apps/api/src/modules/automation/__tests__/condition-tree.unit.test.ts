import { describe, it, expect, vi } from 'vitest';
import {
  evaluateConditionTree,
  parseConditionTree,
  compareOperator,
  type ConditionContext,
} from '../condition.tree.js';
import type { ConditionNode, ConditionLeaf } from '@projectflow/types';

function ctx(over: Partial<ConditionContext> = {}): ConditionContext {
  return {
    fields: { priority: 'HIGH', status: 'In Progress', assigneeId: 'u-1', storyPoints: 5, dueDate: '2026-06-10T00:00:00.000Z' },
    matchesFilter: async () => false,
    userHasRole:   async () => false,
    ...over,
  };
}

const leaf = (l: Partial<ConditionLeaf>): ConditionLeaf =>
  ({ type: 'FIELD_EQUALS', operator: 'is', ...l }) as ConditionLeaf;

describe('compareOperator', () => {
  it('is / is_not', () => {
    expect(compareOperator('is', 'HIGH', 'HIGH')).toBe(true);
    expect(compareOperator('is', 'HIGH', 'LOW')).toBe(false);
    expect(compareOperator('is_not', 'HIGH', 'LOW')).toBe(true);
    expect(compareOperator('is_not', 'HIGH', 'HIGH')).toBe(false);
  });
  it('contains (case-insensitive substring)', () => {
    expect(compareOperator('contains', 'In Progress', 'progress')).toBe(true);
    expect(compareOperator('contains', 'Done', 'progress')).toBe(false);
    // Fail closed: empty/missing expected never matches everything.
    expect(compareOperator('contains', 'anything', '')).toBe(false);
    expect(compareOperator('contains', 'anything', undefined)).toBe(false);
  });
  it('gt / lt (numeric)', () => {
    expect(compareOperator('gt', 5, '3')).toBe(true);
    expect(compareOperator('gt', 2, '3')).toBe(false);
    expect(compareOperator('lt', 2, '3')).toBe(true);
    expect(compareOperator('lt', 5, '3')).toBe(false);
  });
  it('before / after (date)', () => {
    expect(compareOperator('before', '2026-06-10T00:00:00Z', '2026-06-11')).toBe(true);
    expect(compareOperator('before', '2026-06-12T00:00:00Z', '2026-06-11')).toBe(false);
    expect(compareOperator('after',  '2026-06-12T00:00:00Z', '2026-06-11')).toBe(true);
    expect(compareOperator('after',  '2026-06-10T00:00:00Z', '2026-06-11')).toBe(false);
  });
  it('is_set (present & non-empty)', () => {
    expect(compareOperator('is_set', 'u-1', undefined)).toBe(true);
    expect(compareOperator('is_set', '',   undefined)).toBe(false);
    expect(compareOperator('is_set', null, undefined)).toBe(false);
    expect(compareOperator('is_set', undefined, undefined)).toBe(false);
  });
});

describe('evaluateConditionTree — leaves', () => {
  it('a FIELD leaf reads ctx.fields[field]', async () => {
    const node = leaf({ field: 'priority', operator: 'is', value: 'HIGH' });
    expect(await evaluateConditionTree(node, ctx())).toBe(true);
    expect(await evaluateConditionTree(leaf({ field: 'priority', operator: 'is', value: 'LOW' }), ctx())).toBe(false);
  });
  it('a missing field is treated as unset (is_set=false, is=false)', async () => {
    expect(await evaluateConditionTree(leaf({ field: 'nope', operator: 'is_set' }), ctx())).toBe(false);
    expect(await evaluateConditionTree(leaf({ field: 'nope', operator: 'is', value: 'x' }), ctx())).toBe(false);
  });
  it('ISSUE_MATCHES_FILTER delegates to ctx.matchesFilter', async () => {
    const matchesFilter = vi.fn(async () => true);
    const node = leaf({ type: 'ISSUE_MATCHES_FILTER', operator: 'is', pql: 'priority = HIGH' });
    expect(await evaluateConditionTree(node, ctx({ matchesFilter }))).toBe(true);
    expect(matchesFilter).toHaveBeenCalledWith('priority = HIGH');
  });
  it('USER_HAS_ROLE delegates to ctx.userHasRole with the role slug', async () => {
    const userHasRole = vi.fn(async () => true);
    const node = leaf({ type: 'USER_HAS_ROLE', operator: 'is', value: 'workspace-admin' });
    expect(await evaluateConditionTree(node, ctx({ userHasRole }))).toBe(true);
    expect(userHasRole).toHaveBeenCalledWith('workspace-admin');
  });
  it('IN_SPRINT / NOT_IN_SPRINT honour sprintId presence', async () => {
    const withSprint    = ctx({ fields: { sprintId: 's-1' } });
    const withoutSprint = ctx({ fields: {} });
    expect(await evaluateConditionTree(leaf({ type: 'IN_SPRINT',     field: 'sprintId', operator: 'is_set' }), withSprint)).toBe(true);
    expect(await evaluateConditionTree(leaf({ type: 'IN_SPRINT',     field: 'sprintId', operator: 'is_set' }), withoutSprint)).toBe(false);
    expect(await evaluateConditionTree(leaf({ type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_set' }), withoutSprint)).toBe(true);
    expect(await evaluateConditionTree(leaf({ type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_set' }), withSprint)).toBe(false);
  });
});

describe('evaluateConditionTree — groups', () => {
  const hi  = leaf({ field: 'priority', operator: 'is', value: 'HIGH' });
  const lo  = leaf({ field: 'priority', operator: 'is', value: 'LOW' });
  const ip  = leaf({ field: 'status',   operator: 'is', value: 'In Progress' });

  it('AND requires all', async () => {
    expect(await evaluateConditionTree({ op: 'AND', children: [hi, ip] }, ctx())).toBe(true);
    expect(await evaluateConditionTree({ op: 'AND', children: [hi, lo] }, ctx())).toBe(false);
  });
  it('OR requires any (fires for either branch, not otherwise)', async () => {
    expect(await evaluateConditionTree({ op: 'OR', children: [lo, ip] }, ctx())).toBe(true);
    expect(await evaluateConditionTree({ op: 'OR', children: [lo, hi] }, ctx())).toBe(true);
    expect(await evaluateConditionTree({ op: 'OR', children: [lo, leaf({ field: 'status', operator: 'is', value: 'Done' })] }, ctx())).toBe(false);
  });
  it('OR short-circuits — a later resolver is not invoked once a branch matches', async () => {
    const userHasRole = vi.fn(async () => true);
    // hi (priority is HIGH) matches first → the USER_HAS_ROLE branch must not run.
    const node: ConditionNode = { op: 'OR', children: [hi, leaf({ type: 'USER_HAS_ROLE', operator: 'is', value: 'admin' })] };
    expect(await evaluateConditionTree(node, ctx({ userHasRole }))).toBe(true);
    expect(userHasRole).not.toHaveBeenCalled();
  });
  it('AND short-circuits — a later resolver is not invoked once a branch fails', async () => {
    const matchesFilter = vi.fn(async () => true);
    // lo (priority is LOW) fails first → the ISSUE_MATCHES_FILTER branch must not run.
    const node: ConditionNode = { op: 'AND', children: [lo, leaf({ type: 'ISSUE_MATCHES_FILTER', operator: 'is', pql: 'x = y' })] };
    expect(await evaluateConditionTree(node, ctx({ matchesFilter }))).toBe(false);
    expect(matchesFilter).not.toHaveBeenCalled();
  });
  it('nested OR-inside-AND', async () => {
    const node: ConditionNode = { op: 'AND', children: [ip, { op: 'OR', children: [hi, lo] }] };
    expect(await evaluateConditionTree(node, ctx())).toBe(true);
  });
  it('an empty group is vacuously true (rule fires for every event)', async () => {
    expect(await evaluateConditionTree({ op: 'AND', children: [] }, ctx())).toBe(true);
    expect(await evaluateConditionTree({ op: 'OR',  children: [] }, ctx())).toBe(true);
  });
});

describe('parseConditionTree — legacy compatibility', () => {
  it('wraps a legacy flat array in an implicit top-level AND', () => {
    const legacy = [
      { type: 'FIELD_EQUALS' as const, field: 'priority', value: 'HIGH' },
      { type: 'FIELD_NOT_EQUALS' as const, field: 'status', value: 'Done' },
    ];
    const tree = parseConditionTree(legacy);
    expect(tree).toEqual({
      op: 'AND',
      children: [
        { type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGH' },
        { type: 'FIELD_NOT_EQUALS', field: 'status', operator: 'is_not', value: 'Done' },
      ],
    });
  });
  it('maps legacy IN_SPRINT to is_set on sprintId', () => {
    const tree = parseConditionTree([{ type: 'IN_SPRINT' as const }]);
    expect(tree).toEqual({ op: 'AND', children: [{ type: 'IN_SPRINT', field: 'sprintId', operator: 'is_set' }] });
  });
  it('maps legacy NOT_IN_SPRINT to is_set on sprintId (inverted in evaluator)', () => {
    const tree = parseConditionTree([{ type: 'NOT_IN_SPRINT' as const }]);
    expect(tree).toEqual({ op: 'AND', children: [{ type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_set' }] });
  });
  it('passes an already-tree value through unchanged', () => {
    const node = { op: 'OR' as const, children: [{ type: 'FIELD_EQUALS' as const, operator: 'is' as const, field: 'p', value: 'x' }] };
    expect(parseConditionTree(node)).toBe(node);
  });
  it('an empty array becomes an empty AND group', () => {
    expect(parseConditionTree([])).toEqual({ op: 'AND', children: [] });
  });
});
