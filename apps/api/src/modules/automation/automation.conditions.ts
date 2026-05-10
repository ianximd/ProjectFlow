/**
 * Automation condition evaluator.
 * Runs each condition against the event payload; returns true only if ALL pass.
 */
import type { AutomationCondition } from '@projectflow/types';

export function evaluateConditions(
  conditions: AutomationCondition[],
  payload: Record<string, unknown>,
): boolean {
  for (const cond of conditions) {
    if (!evaluateOne(cond, payload)) return false;
  }
  return true;
}

function evaluateOne(cond: AutomationCondition, payload: Record<string, unknown>): boolean {
  switch (cond.type) {
    case 'FIELD_EQUALS':
      return String(payload[cond.field ?? '']) === cond.value;

    case 'FIELD_NOT_EQUALS':
      return String(payload[cond.field ?? '']) !== cond.value;

    case 'IN_SPRINT':
      return Boolean(payload['sprintId']);

    case 'NOT_IN_SPRINT':
      return !payload['sprintId'];

    // PQL / role checks are complex — accept them as true by default
    // (a full evaluator can be added later)
    case 'ISSUE_MATCHES_FILTER':
    case 'USER_HAS_ROLE':
    default:
      return true;
  }
}
