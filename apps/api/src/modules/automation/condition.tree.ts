/**
 * Pure automation condition engine (Phase 6b).
 *
 * Evaluates a recursive AND/OR ConditionNode against a ConditionContext.
 * No IO lives here: the two checks that need data (ISSUE_MATCHES_FILTER,
 * USER_HAS_ROLE) are supplied as async resolvers on the context, so the
 * tree walk + operator comparisons are fully unit-testable in isolation.
 *
 * A legacy flat AutomationCondition[] is normalised to an implicit top-level
 * AND group by parseConditionTree() — no data migration is required.
 */
import {
  isConditionGroup,
  type AutomationCondition,
  type ConditionLeaf,
  type ConditionNode,
  type ConditionOperator,
} from '@projectflow/types';

/** The evaluation context: flattened task fields + injected IO resolvers. */
export interface ConditionContext {
  fields: Record<string, unknown>;
  matchesFilter: (pql: string) => Promise<boolean>;
  userHasRole: (roleSlug: string) => Promise<boolean>;
}

/** Compare a single leaf's actual value against its expected value with an operator. */
export function compareOperator(
  operator: ConditionOperator,
  actual: unknown,
  expected: string | undefined,
): boolean {
  switch (operator) {
    case 'is':
      return String(actual ?? '') === String(expected ?? '');
    case 'is_not':
      return String(actual ?? '') !== String(expected ?? '');
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'gt': {
      const a = Number(actual), e = Number(expected);
      return Number.isFinite(a) && Number.isFinite(e) && a > e;
    }
    case 'lt': {
      const a = Number(actual), e = Number(expected);
      return Number.isFinite(a) && Number.isFinite(e) && a < e;
    }
    case 'before': {
      const a = Date.parse(String(actual)), e = Date.parse(String(expected));
      return Number.isFinite(a) && Number.isFinite(e) && a < e;
    }
    case 'after': {
      const a = Date.parse(String(actual)), e = Date.parse(String(expected));
      return Number.isFinite(a) && Number.isFinite(e) && a > e;
    }
    case 'is_set':
      return actual !== undefined && actual !== null && String(actual) !== '';
    default:
      return false;
  }
}

/** Evaluate one leaf against the context. */
async function evaluateLeaf(leaf: ConditionLeaf, ctx: ConditionContext): Promise<boolean> {
  switch (leaf.type) {
    case 'ISSUE_MATCHES_FILTER':
      return leaf.pql ? ctx.matchesFilter(leaf.pql) : false;
    case 'USER_HAS_ROLE':
      return leaf.value ? ctx.userHasRole(leaf.value) : false;
    default: {
      const actual = leaf.field ? ctx.fields[leaf.field] : undefined;
      if (leaf.type === 'IN_SPRINT')     return compareOperator('is_set', actual, undefined);
      if (leaf.type === 'NOT_IN_SPRINT') return !compareOperator('is_set', actual, undefined);
      return compareOperator(leaf.operator, actual, leaf.value);
    }
  }
}

/**
 * Recursively evaluate a ConditionNode. AND = every child true; OR = any child
 * true. An empty group is vacuously true (a rule with no conditions fires on
 * every event — matches the legacy "no conditions" semantics).
 */
export async function evaluateConditionTree(node: ConditionNode, ctx: ConditionContext): Promise<boolean> {
  if (isConditionGroup(node)) {
    if (node.children.length === 0) return true;
    if (node.op === 'AND') {
      for (const child of node.children) {
        if (!(await evaluateConditionTree(child, ctx))) return false;
      }
      return true;
    }
    for (const child of node.children) {
      if (await evaluateConditionTree(child, ctx)) return true;
    }
    return false;
  }
  return evaluateLeaf(node, ctx);
}

/** Default operator for a legacy leaf that predates the operator field. */
function legacyOperator(c: AutomationCondition): ConditionOperator {
  switch (c.type) {
    case 'FIELD_NOT_EQUALS': return 'is_not';
    default:                 return 'is';
  }
}

/** Convert a single legacy condition into a leaf node. */
function legacyToLeaf(c: AutomationCondition): ConditionLeaf {
  if (c.type === 'IN_SPRINT')     return { type: 'IN_SPRINT',     field: 'sprintId', operator: 'is_set' };
  if (c.type === 'NOT_IN_SPRINT') return { type: 'NOT_IN_SPRINT', field: 'sprintId', operator: 'is_set' };

  // Build the leaf conditionally to avoid undefined keys that could break toEqual checks
  const leaf: ConditionLeaf = {
    type:     c.type,
    operator: legacyOperator(c),
  };
  if (c.field !== undefined) leaf.field = c.field;
  if (c.value !== undefined) leaf.value = c.value;
  if (c.pql   !== undefined) leaf.pql   = c.pql;
  return leaf;
}

/**
 * Normalise stored conditions to a canonical ConditionNode.
 * - A legacy flat AutomationCondition[] → implicit top-level AND group.
 * - An already-tree value → returned unchanged.
 */
export function parseConditionTree(stored: AutomationCondition[] | ConditionNode): ConditionNode {
  if (Array.isArray(stored)) {
    return { op: 'AND', children: stored.map(legacyToLeaf) };
  }
  return stored;
}
