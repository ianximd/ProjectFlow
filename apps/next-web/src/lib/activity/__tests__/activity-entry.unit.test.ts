import { describe, it, expect } from 'vitest';
import { taskEventToEntry, prependEntry, KIND_ACTION } from '../activity-entry';
import type { AuditLogEntry } from '@projectflow/types';
import type { TaskEvent } from '@/lib/realtime/apply-task-event';

const BASE_ENTRY: AuditLogEntry = {
  id: 'e1',
  workspaceId: 'ws1',
  userId: 'u1',
  userEmail: 'user@example.com',
  action: 'CREATE',
  resource: 'Task',
  resourceId: 't1',
  oldValues: null,
  newValues: null,
  ipAddress: null,
  userAgent: null,
  createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
};

const makeFeed = (n: number): AuditLogEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    ...BASE_ENTRY,
    id: `e${i + 1}`,
    createdAt: new Date(Date.now() - i * 1000).toISOString(),
  }));

describe('KIND_ACTION', () => {
  it('maps "created" to "CREATE"', () => {
    expect(KIND_ACTION['created']).toBe('CREATE');
  });
  it('maps "updated" to "UPDATE"', () => {
    expect(KIND_ACTION['updated']).toBe('UPDATE');
  });
  it('maps "deleted" to "DELETE"', () => {
    expect(KIND_ACTION['deleted']).toBe('DELETE');
  });
});

describe('taskEventToEntry', () => {
  it('converts a created task event into an AuditLogEntry', () => {
    const ev: TaskEvent = {
      kind: 'created',
      task: { id: 't99', title: 'New task', status: 'TODO', priority: 'MEDIUM', type: 'TASK', storyPoints: null, startDate: null, dueDate: null, sprintId: null, updatedAt: null, customFieldValues: null, assignees: null },
    };
    const entry = taskEventToEntry(ev);
    expect(entry).not.toBeNull();
    expect(entry!.action).toBe('CREATE');
    expect(entry!.resource).toBe('Task');
    expect(entry!.resourceId).toBe('t99');
    expect(entry!.newValues).toMatchObject({ title: 'New task' });
  });

  it('converts an updated task event', () => {
    const ev: TaskEvent = {
      kind: 'updated',
      task: { id: 't88', title: 'Updated', status: 'IN_PROGRESS', priority: 'HIGH', type: 'TASK', storyPoints: null, startDate: null, dueDate: null, sprintId: null, updatedAt: null, customFieldValues: null, assignees: null },
    };
    const entry = taskEventToEntry(ev);
    expect(entry!.action).toBe('UPDATE');
    expect(entry!.resourceId).toBe('t88');
  });

  it('converts a deleted task event (taskId only path)', () => {
    const ev: TaskEvent = { kind: 'deleted', taskId: 'del-1' };
    const entry = taskEventToEntry(ev);
    expect(entry!.action).toBe('DELETE');
    expect(entry!.resourceId).toBe('del-1');
  });

  it('converts a deleted event with task.id when taskId absent', () => {
    const ev: TaskEvent = {
      kind: 'deleted',
      task: { id: 'del-2', title: 'Deleted', status: 'DONE', priority: 'LOW', type: 'TASK', storyPoints: null, startDate: null, dueDate: null, sprintId: null, updatedAt: null, customFieldValues: null, assignees: null },
    };
    const entry = taskEventToEntry(ev);
    expect(entry!.resourceId).toBe('del-2');
  });

  it('returns null when neither taskId nor task is present on deleted event', () => {
    const ev: TaskEvent = { kind: 'deleted' };
    expect(taskEventToEntry(ev)).toBeNull();
  });
});

describe('prependEntry', () => {
  it('adds a new entry to the front of the feed', () => {
    const feed = makeFeed(3);
    const newEntry: AuditLogEntry = { ...BASE_ENTRY, id: 'new-1' };
    const result = prependEntry(feed, newEntry);
    expect(result[0]).toBe(newEntry);
    expect(result.length).toBe(4);
  });

  it('does not mutate the original array', () => {
    const feed = makeFeed(2);
    const newEntry: AuditLogEntry = { ...BASE_ENTRY, id: 'new-2' };
    prependEntry(feed, newEntry);
    expect(feed.length).toBe(2);
  });

  it('de-duplicates by id (existing entry in feed should not be re-added)', () => {
    const feed = makeFeed(2);
    // Try to prepend an entry that is already in the feed
    const duplicate: AuditLogEntry = { ...feed[0]! };
    const result = prependEntry(feed, duplicate);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(duplicate);
  });

  it('caps the feed at 200 entries', () => {
    const feed = makeFeed(200);
    const newEntry: AuditLogEntry = { ...BASE_ENTRY, id: 'cap-1' };
    const result = prependEntry(feed, newEntry);
    expect(result.length).toBe(200);
    expect(result[0]).toBe(newEntry);
  });
});
