import { describe, it, expect } from 'vitest';
import { renameToken, TRIGGER_RENAMES, ACTION_RENAMES } from '../automation.taxonomy.js';

describe('automation taxonomy rename', () => {
  it('renames legacy trigger tokens to ClickUp semantics', () => {
    expect(renameToken('ISSUE_CREATED')).toBe('TASK_CREATED');
    expect(renameToken('ISSUE_TRANSITIONED')).toBe('STATUS_CHANGED');
    expect(renameToken('DUE_DATE_APPROACHING')).toBe('DUE_DATE_PASSED');
  });

  it('renames legacy action tokens', () => {
    expect(renameToken('TRANSITION_ISSUE')).toBe('CHANGE_STATUS');
    expect(renameToken('ASSIGN_ISSUE')).toBe('ASSIGN');
    expect(renameToken('ADD_COMMENT')).toBe('POST_COMMENT');
    expect(renameToken('TRIGGER_WEBHOOK')).toBe('CALL_WEBHOOK');
  });

  it('passes through already-renamed or unknown tokens unchanged', () => {
    expect(renameToken('STATUS_CHANGED')).toBe('STATUS_CHANGED');
    expect(renameToken('SPRINT_STARTED')).toBe('SPRINT_STARTED');
    expect(renameToken('NONSENSE')).toBe('NONSENSE');
  });

  it('exposes the canonical rename maps', () => {
    expect(TRIGGER_RENAMES.ISSUE_UPDATED).toBe('TASK_UPDATED');
    expect(ACTION_RENAMES.UNASSIGN_ISSUE).toBe('UNASSIGN');
  });
});
