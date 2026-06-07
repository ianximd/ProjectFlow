/**
 * Automation taxonomy rename (Phase 6a). The 0039 data migration rewrites stored
 * JSON; this module mirrors the same map so any old token read at runtime (e.g.
 * a rule created against a not-yet-migrated row) is normalized to ClickUp
 * semantics before evaluation.
 */
export const TRIGGER_RENAMES: Record<string, string> = {
  ISSUE_CREATED:        'TASK_CREATED',
  ISSUE_UPDATED:        'TASK_UPDATED',
  ISSUE_TRANSITIONED:   'STATUS_CHANGED',
  DUE_DATE_APPROACHING: 'DUE_DATE_PASSED',
};

export const ACTION_RENAMES: Record<string, string> = {
  TRANSITION_ISSUE: 'CHANGE_STATUS',
  ASSIGN_ISSUE:     'ASSIGN',
  UNASSIGN_ISSUE:   'UNASSIGN',
  ADD_COMMENT:      'POST_COMMENT',
  TRIGGER_WEBHOOK:  'CALL_WEBHOOK',
};

const ALL_RENAMES: Record<string, string> = { ...TRIGGER_RENAMES, ...ACTION_RENAMES };

/** Map a single legacy token to its new form; pass through unknown/new tokens. */
export function renameToken(token: string): string {
  return ALL_RENAMES[token] ?? token;
}
