import { describe, it, expect } from 'vitest';
import { formatAuditEntry, groupByDay } from './auditDiff';
import type { AuditLogEntry } from '@projectflow/types';

const base: AuditLogEntry = {
  id: '1', workspaceId: 'w', userId: 'u', userEmail: 'amy@x.io',
  action: 'UPDATE', resource: 'Task', resourceId: 't1',
  oldValues: null, newValues: null, ipAddress: null, userAgent: null,
  createdAt: '2026-06-27T10:00:00.000Z',
};

describe('formatAuditEntry', () => {
  it('renders known field changes as from -> to', () => {
    const r = formatAuditEntry({ ...base,
      oldValues: { status: 'TODO', priority: 'LOW' },
      newValues: { status: 'IN_PROGRESS', priority: 'HIGH' } });
    expect(r.changes).toContainEqual({ field: 'status', from: 'TODO', to: 'IN_PROGRESS' });
    expect(r.changes).toContainEqual({ field: 'priority', from: 'LOW', to: 'HIGH' });
  });

  it('falls back to JSON for unknown/object values', () => {
    const r = formatAuditEntry({ ...base,
      oldValues: { meta: { a: 1 } }, newValues: { meta: { a: 2 } } });
    expect(r.changes[0].from).toContain('a');
    expect(r.changes[0].to).toContain('2');
  });

  it('summarizes CREATE without a diff', () => {
    const r = formatAuditEntry({ ...base, action: 'CREATE' });
    expect(r.summary.toLowerCase()).toContain('created');
    expect(r.changes).toEqual([]);
  });
});

describe('groupByDay', () => {
  it('buckets entries by calendar day, newest first', () => {
    const e1 = { ...base, id: 'a', createdAt: '2026-06-27T10:00:00.000Z' };
    const e2 = { ...base, id: 'b', createdAt: '2026-06-26T09:00:00.000Z' };
    const groups = groupByDay([e2, e1]);
    expect(groups[0].entries[0].id).toBe('a');
    expect(groups).toHaveLength(2);
  });
});
