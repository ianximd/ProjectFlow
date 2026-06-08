import type { AutomationCondition, ConditionNode, ConditionLeaf, ConditionGroup } from '@projectflow/types';

export function emptyGroup(op: 'AND' | 'OR' = 'AND'): ConditionGroup {
  return { op, children: [] };
}

export function emptyLeaf(): ConditionLeaf {
  return { type: 'FIELD_EQUALS', field: 'priority', operator: 'is', value: 'HIGH' };
}

export function isGroup(node: ConditionNode): node is ConditionGroup {
  return (node as ConditionGroup).op === 'AND' || (node as ConditionGroup).op === 'OR';
}

/** Normalise stored conditions (legacy array OR tree) into a ConditionNode for editing. */
export function parseConditionTreeClient(stored: AutomationCondition[] | ConditionNode | undefined): ConditionNode {
  if (!stored) return emptyGroup('AND');
  if (Array.isArray(stored)) {
    return {
      op: 'AND',
      children: stored.map((c): ConditionLeaf => ({
        type:     c.type,
        field:    c.field,
        operator: c.type === 'FIELD_NOT_EQUALS' ? 'is_not' : (c.type === 'IN_SPRINT' || c.type === 'NOT_IN_SPRINT' ? 'is_set' : 'is'),
        value:    c.value,
        pql:      c.pql,
      })),
    };
  }
  return stored;
}

/** Count leaf conditions in a tree (for the rule-row badge). */
export function countLeaves(node: ConditionNode | AutomationCondition[] | undefined): number {
  if (!node) return 0;
  const tree = Array.isArray(node) ? parseConditionTreeClient(node) : node;
  return isGroup(tree) ? tree.children.reduce((n, c) => n + countLeaves(c), 0) : 1;
}
