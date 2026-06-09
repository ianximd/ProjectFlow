import { describe, it, expect } from 'vitest';
import { toConditionFields, toFilterTask, taskToPayloadFields } from '../condition.context.js';

describe('condition.context pure mappers', () => {
  describe('toConditionFields', () => {
    it('maps a STATUS_CHANGED payload onto the field map', () => {
      const fields = toConditionFields({
        actorId: 'u1',
        fromStatus: 'A',
        toStatus: 'B',
        status: 'B',
        reporterId: 'r1',
      });
      expect(fields.status).toBe('B');
      expect(fields.fromStatus).toBe('A');
      expect(fields.reporterId).toBe('r1');
    });

    it('falls back to toStatus when status is absent', () => {
      const fields = toConditionFields({ toStatus: 'Done' });
      expect(fields.status).toBe('Done');
    });

    it('exposes an arbitrary extra key via the spread', () => {
      const fields = toConditionFields({ customField: 'x' });
      expect(fields.customField).toBe('x');
    });

    it('collapses an absent field to null (locks the ?? null contract)', () => {
      const fields = toConditionFields({});
      expect(fields.priority).toBeNull();
      expect(fields.status).toBeNull();
      expect(fields.sprintId).toBeNull();
    });
  });

  describe('toFilterTask', () => {
    it('maps priority/assignee and falls back status to toStatus', () => {
      const task = toFilterTask({ priority: 'HIGH', assigneeId: 'u1', toStatus: 'Blocked' });
      expect(task.priority).toBe('HIGH');
      expect(task.assigneeId).toBe('u1');
      expect(task.status).toBe('Blocked');
    });

    it('collapses unset fields to null, not undefined', () => {
      const task = toFilterTask({});
      expect(task.priority).toBeNull();
      expect(task.status).toBeNull();
      expect(task.assigneeId).toBeNull();
    });
  });

  describe('taskToPayloadFields', () => {
    it('maps a PascalCase DB row to camelCase payload fields', () => {
      const result = taskToPayloadFields({
        Status: 'open', Priority: 'high', Type: 'task',
        AssigneeIds: ['U1', 'U2'], ReporterId: 'R1', SprintId: 'S1',
        DueDate: '2026-06-09', StoryPoints: 3, Title: 'T',
      });
      expect(result).toEqual({
        status: 'open', priority: 'high', type: 'task',
        assigneeId: 'U1', reporterId: 'R1', sprintId: 'S1',
        dueDate: '2026-06-09', storyPoints: 3, title: 'T',
      });
    });

    it('maps a camelCase row to the same camelCase payload fields', () => {
      const result = taskToPayloadFields({
        status: 'open', priority: 'high', type: 'task',
        assigneeIds: ['U1', 'U2'], reporterId: 'R1', sprintId: 'S1',
        dueDate: '2026-06-09', storyPoints: 3, title: 'T',
      });
      expect(result).toEqual({
        status: 'open', priority: 'high', type: 'task',
        assigneeId: 'U1', reporterId: 'R1', sprintId: 'S1',
        dueDate: '2026-06-09', storyPoints: 3, title: 'T',
      });
    });

    it('returns {} for null input', () => {
      expect(taskToPayloadFields(null)).toEqual({});
    });

    it('returns {} for undefined input', () => {
      expect(taskToPayloadFields(undefined)).toEqual({});
    });

    it('resolves assigneeId from a comma-separated string (first id)', () => {
      const result = taskToPayloadFields({ AssigneeIds: 'U1,U2' });
      expect(result.assigneeId).toBe('U1');
    });

    it('sets assigneeId to null when assigneeIds is absent', () => {
      const result = taskToPayloadFields({ Status: 'open' });
      expect(result.assigneeId).toBeNull();
    });

    it('sets assigneeId to null when assigneeIds array is empty', () => {
      const result = taskToPayloadFields({ AssigneeIds: [] });
      expect(result.assigneeId).toBeNull();
    });

    it('collapses all absent fields to null', () => {
      const result = taskToPayloadFields({});
      expect(result.status).toBeNull();
      expect(result.priority).toBeNull();
      expect(result.type).toBeNull();
      expect(result.assigneeId).toBeNull();
      expect(result.reporterId).toBeNull();
      expect(result.sprintId).toBeNull();
      expect(result.dueDate).toBeNull();
      expect(result.storyPoints).toBeNull();
      expect(result.title).toBeNull();
    });
  });
});
