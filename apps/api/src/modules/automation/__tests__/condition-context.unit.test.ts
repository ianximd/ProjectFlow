import { describe, it, expect } from 'vitest';
import { toConditionFields, toFilterTask } from '../condition.context.js';

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
});
