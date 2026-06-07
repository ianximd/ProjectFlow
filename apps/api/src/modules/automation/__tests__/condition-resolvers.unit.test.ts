import { describe, it, expect, vi } from 'vitest';
import { matchesFilterPQL, makeUserHasRole, type FilterTask } from '../condition.resolvers.js';

const task: FilterTask = {
  status: 'In Progress',
  priority: 'HIGH',
  type: 'TASK',
  assigneeId: 'u-1',
  reporterId: 'u-2',
  sprintId: 's-1',
  dueDate: '2026-06-10T00:00:00.000Z',
  title: 'Fix the login bug',
};

describe('matchesFilterPQL', () => {
  it('matches a simple equality filter', () => {
    expect(matchesFilterPQL('priority = HIGH', task, 'u-9')).toBe(true);
    expect(matchesFilterPQL('priority = LOW',  task, 'u-9')).toBe(false);
  });
  it('matches status (free text in PQL keeps case)', () => {
    expect(matchesFilterPQL('status = "In Progress"', task, 'u-9')).toBe(true);
  });
  it('ANDs multiple clauses', () => {
    expect(matchesFilterPQL('priority = HIGH AND status = "In Progress"', task, 'u-9')).toBe(true);
    expect(matchesFilterPQL('priority = HIGH AND status = "Done"',        task, 'u-9')).toBe(false);
  });
  it('resolves currentUser() against the supplied actorId', () => {
    expect(matchesFilterPQL('assignee = currentUser()', task, 'u-1')).toBe(true);
    expect(matchesFilterPQL('assignee = currentUser()', task, 'u-9')).toBe(false);
  });
  it('matches a free-text term against the title', () => {
    expect(matchesFilterPQL('login', task, 'u-9')).toBe(true);
    expect(matchesFilterPQL('logout', task, 'u-9')).toBe(false);
  });
  it('an empty PQL matches everything', () => {
    expect(matchesFilterPQL('', task, 'u-9')).toBe(true);
  });
});

describe('makeUserHasRole', () => {
  it('is true when the user holds the role slug in the workspace', async () => {
    const listUserRoles = vi.fn(async () => [{ roleSlug: 'workspace-admin' }, { roleSlug: 'member' }]);
    const userHasRole = makeUserHasRole(listUserRoles as any, 'u-1', 'ws-1');
    expect(await userHasRole('workspace-admin')).toBe(true);
    expect(listUserRoles).toHaveBeenCalledWith('u-1', 'ws-1');
  });
  it('is false when the user lacks the role', async () => {
    const listUserRoles = vi.fn(async () => [{ roleSlug: 'member' }]);
    const userHasRole = makeUserHasRole(listUserRoles as any, 'u-1', 'ws-1');
    expect(await userHasRole('workspace-admin')).toBe(false);
  });
  it('is false (fail-closed) when there is no actor', async () => {
    const listUserRoles = vi.fn(async () => [{ roleSlug: 'workspace-admin' }]);
    const userHasRole = makeUserHasRole(listUserRoles as any, null, 'ws-1');
    expect(await userHasRole('workspace-admin')).toBe(false);
    expect(listUserRoles).not.toHaveBeenCalled();
  });
});
