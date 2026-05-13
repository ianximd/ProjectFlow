/**
 * computeChangedFields — picks only the keys that actually differ.
 * Tests the building block; the integration test exercises the
 * middleware-driven before/after capture end-to-end.
 */

import { describe, expect, it } from 'vitest';
import { computeChangedFields } from '../audit-snapshots.js';

describe('computeChangedFields', () => {
  it('returns nulls when both sides are null', () => {
    expect(computeChangedFields(null, null)).toEqual({ oldValues: null, newValues: null });
  });

  it('returns the full after-state as NewValues when before is null (create-shape)', () => {
    const out = computeChangedFields(null, { id: 'x', title: 'T' });
    expect(out).toEqual({ oldValues: null, newValues: { id: 'x', title: 'T' } });
  });

  it('returns the full before-state as OldValues when after is null (delete-shape)', () => {
    const out = computeChangedFields({ id: 'x', title: 'T' }, null);
    expect(out).toEqual({ oldValues: { id: 'x', title: 'T' }, newValues: null });
  });

  it('picks only the changed keys for an update', () => {
    const before = { id: 'x', title: 'Old', priority: 'LOW',  status: 'TODO' };
    const after  = { id: 'x', title: 'New', priority: 'HIGH', status: 'TODO' };
    expect(computeChangedFields(before, after)).toEqual({
      oldValues: { title: 'Old', priority: 'LOW' },
      newValues: { title: 'New', priority: 'HIGH' },
    });
  });

  it('returns nulls for an update where nothing changed', () => {
    const same = { id: 'x', title: 'T', priority: 'LOW' };
    expect(computeChangedFields(same, { ...same })).toEqual({ oldValues: null, newValues: null });
  });

  it('ignores UpdatedAt-type fields so SP-managed timestamps do not pollute the diff', () => {
    const before = { id: 'x', title: 'T', updatedAt: new Date('2026-05-13T10:00:00Z') };
    const after  = { id: 'x', title: 'T', updatedAt: new Date('2026-05-13T10:00:05Z') };
    expect(computeChangedFields(before, after)).toEqual({ oldValues: null, newValues: null });
  });

  it('treats two Dates with the same instant as equal', () => {
    const before = { id: 'x', dueDate: new Date('2026-06-01T00:00:00Z') };
    const after  = { id: 'x', dueDate: new Date('2026-06-01T00:00:00Z') };
    expect(computeChangedFields(before, after)).toEqual({ oldValues: null, newValues: null });
  });

  it('emits a diff for two Dates that differ', () => {
    const before = { id: 'x', dueDate: new Date('2026-06-01T00:00:00Z') };
    const after  = { id: 'x', dueDate: new Date('2026-06-02T00:00:00Z') };
    const out = computeChangedFields(before, after);
    expect((out.newValues as any).dueDate).toEqual(new Date('2026-06-02T00:00:00Z'));
    expect((out.oldValues as any).dueDate).toEqual(new Date('2026-06-01T00:00:00Z'));
  });

  it('treats two arrays with the same elements as equal (shallow JSON compare)', () => {
    const before = { id: 'x', labels: ['a', 'b'] };
    const after  = { id: 'x', labels: ['a', 'b'] };
    expect(computeChangedFields(before, after)).toEqual({ oldValues: null, newValues: null });
  });

  it('emits a diff for arrays with different elements', () => {
    const before = { id: 'x', labels: ['a', 'b'] };
    const after  = { id: 'x', labels: ['a', 'c'] };
    const out = computeChangedFields(before, after);
    expect(out.oldValues).toEqual({ labels: ['a', 'b'] });
    expect(out.newValues).toEqual({ labels: ['a', 'c'] });
  });

  it('preserves null in the diff (a field cleared to null is still a change)', () => {
    const before = { id: 'x', assignee: 'user-1' };
    const after  = { id: 'x', assignee: null };
    expect(computeChangedFields(before, after)).toEqual({
      oldValues: { assignee: 'user-1' },
      newValues: { assignee: null },
    });
  });

  it('captures keys that newly appeared in after as additions', () => {
    const before = { id: 'x' };
    const after  = { id: 'x', sprintId: 'sp-1' };
    expect(computeChangedFields(before, after)).toEqual({
      oldValues: { sprintId: null },
      newValues: { sprintId: 'sp-1' },
    });
  });
});
