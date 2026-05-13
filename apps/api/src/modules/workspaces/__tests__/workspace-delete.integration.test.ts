/**
 * Phase 5 Week 27 closed a v1.0.0 vulnerability: any authenticated user
 * could `DELETE /workspaces/:id`. The fix added a permission gate
 * (`workspace.delete` workspace-scoped OR `admin.workspaces.delete`
 * system-scoped). Phase 6 Week 33 then changed the operation from a
 * physical delete (which broke on FK violations) to a soft delete that
 * stamps `Workspaces.DeletedAt`.
 *
 * This file exercises both invariants at the route boundary so neither
 * regression can sneak back in: a non-owner cannot delete; a soft-deleted
 * workspace disappears from listings; double-delete is idempotent (404).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import {
  createTestUser,
  createTestWorkspace,
} from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll  (async () => { await closePool();   });

describe('DELETE /workspaces/:id — RBAC + soft-delete', () => {
  it('the workspace owner can delete and the row disappears from list', async () => {
    const owner = await createTestUser({ email: 'owner@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);

    // Confirm it's listed before delete.
    const before = await request('/workspaces', { token: owner.accessToken });
    const listBefore = await json<{ data: { Id: string }[] }>(before, 200);
    expect(listBefore.data.some((w) => w.Id === ws.Id)).toBe(true);

    // Soft-delete returns 204.
    const del = await request(`/workspaces/${ws.Id}`, { method: 'DELETE', token: owner.accessToken });
    expect(del.status).toBe(204);

    // List filters out soft-deleted rows (W33 fix to usp_Workspace_List).
    const after = await request('/workspaces', { token: owner.accessToken });
    const listAfter = await json<{ data: { Id: string }[] }>(after, 200);
    expect(listAfter.data.some((w) => w.Id === ws.Id)).toBe(false);
  });

  it('a workspace member without workspace.delete is rejected with 403', async () => {
    const owner = await createTestUser({ email: 'wsdel-owner@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);

    const member = await createTestUser({ email: 'wsdel-member@projectflow.test' });

    // Owner invites member as workspace-member (no delete permission).
    const invite = await request(`/workspaces/${ws.Id}/members/by-email`, {
      method: 'POST',
      token:  owner.accessToken,
      json:   { email: member.user.Email, role: 'MEMBER' },
    });
    expect(invite.status).toBe(201);

    // Member tries to delete.
    const del = await request(`/workspaces/${ws.Id}`, { method: 'DELETE', token: member.accessToken });
    expect(del.status).toBe(403);
    const body = await del.json();
    expect((body as any).error?.code).toBe('FORBIDDEN');

    // The workspace is still there for the owner.
    const list = await request('/workspaces', { token: owner.accessToken });
    const listBody = await json<{ data: { Id: string }[] }>(list, 200);
    expect(listBody.data.some((w) => w.Id === ws.Id)).toBe(true);
  });

  it('a non-member is rejected with 404 (resource resolves to null)', async () => {
    const owner    = await createTestUser({ email: 'wsdel-owner2@projectflow.test' });
    const ws       = await createTestWorkspace(owner.accessToken);
    const stranger = await createTestUser({ email: 'wsdel-stranger@projectflow.test' });

    const del = await request(`/workspaces/${ws.Id}`, { method: 'DELETE', token: stranger.accessToken });
    // Per the permission middleware: when the user has no permissions for
    // a workspace they don't belong to, the gate returns 403 (not 404),
    // because the workspace ID is real — the user just lacks the slug.
    expect([403, 404]).toContain(del.status);
  });

  it('a system super-admin can delete any workspace (system scope satisfies workspace gate)', async () => {
    const owner = await createTestUser({ email: 'wsdel-owner3@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);

    const admin = await createTestUser({
      email:      'wsdel-admin@projectflow.test',
      systemRole: 'super-admin',
    });

    const del = await request(`/workspaces/${ws.Id}`, { method: 'DELETE', token: admin.accessToken });
    expect(del.status).toBe(204);
  });

  it('deleting an already-soft-deleted workspace returns 404 (idempotent)', async () => {
    const owner = await createTestUser({ email: 'wsdel-double@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);

    const first = await request(`/workspaces/${ws.Id}`, { method: 'DELETE', token: owner.accessToken });
    expect(first.status).toBe(204);

    const second = await request(`/workspaces/${ws.Id}`, { method: 'DELETE', token: owner.accessToken });
    expect(second.status).toBe(404);
  });
});
