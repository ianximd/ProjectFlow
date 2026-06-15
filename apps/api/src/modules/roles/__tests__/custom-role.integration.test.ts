/**
 * Phase 10b — Custom-role integration coverage.
 * Creates a workspace custom role from a permission-slug set, assigns it, and
 * proves the user's effective slugs (usp_UserPermissions_Get) equal exactly the
 * role's slugs — no floor leakage, system roles immutable, per-workspace slug
 * isolation. DB SAFETY: targets local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { roleService } from '../role.service.js';
import { roleRepository } from '../role.repository.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('workspace custom roles', () => {
  it('a created custom role + assignment grants the user EXACTLY its slugs', async () => {
    const owner  = await createTestUser({ email: `cr-owner-${Date.now()}@projectflow.test` });
    const member = await createTestUser({ email: `cr-member-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);

    // owner holds workspace-owner → has role.manage. Bundle two real WORKSPACE slugs.
    const perms = await roleService.listPermissions('WORKSPACE');
    const taskRead   = perms.find((p) => p.slug === 'task.read')!;
    const reportRead = perms.find((p) => p.slug === 'report.read')!;

    const created = await roleService.createWorkspaceRole({
      workspaceId: ws.Id, name: 'QA Reviewer', description: null,
      permissionIds: [taskRead.id, reportRead.id], actorId: owner.user.Id,
    });
    expect(created.workspaceId).toBe(ws.Id);
    expect(created.isSystem).toBe(false);

    const assigned = await roleService.assignWorkspaceRole({
      workspaceId: ws.Id, userId: member.user.Id, roleId: created.id, actorId: owner.user.Id,
    });
    expect(assigned.ok).toBe(true);

    // Effective slugs for the member in this workspace = EXACTLY the role's two.
    const slugs = await roleRepository.getUserPermissionSlugs(member.user.Id, ws.Id);
    expect([...slugs].sort()).toEqual(['report.read', 'task.read']);
  });

  it('refuses to mutate a system role (immutable / not this workspace’s custom role)', async () => {
    const owner = await createTestUser({ email: `cr-sys-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const sysMember = await roleService.getRoleBySlug('workspace-member');
    const res = await roleService.updateWorkspaceRole({
      workspaceId: ws.Id, roleId: sysMember!.id, name: 'Hacked', actorId: owner.user.Id,
    });
    expect(res.ok).toBe(false);
    // system role has workspaceId null → not "this workspace's custom role"
    expect((res as any).code).toBe('NOT_FOUND');
  });

  it('isolates custom-role slugs per workspace', async () => {
    const owner = await createTestUser({ email: `cr-iso-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(owner.accessToken);
    const wsB = await createTestWorkspace(owner.accessToken);
    // Same human-readable name in both workspaces is allowed (slug unique per-ws).
    const a = await roleService.createWorkspaceRole({ workspaceId: wsA.Id, name: 'Lead', permissionIds: [], actorId: owner.user.Id });
    const b = await roleService.createWorkspaceRole({ workspaceId: wsB.Id, name: 'Lead', permissionIds: [], actorId: owner.user.Id });
    expect(a.id).not.toBe(b.id);
    expect(a.slug).toBe(b.slug); // 'lead' in both — allowed because WorkspaceId differs

    const listA = await roleService.listWorkspaceRoles(wsA.Id);
    expect(listA.some((r) => r.id === b.id)).toBe(false); // wsB's role not visible from wsA
  });

  it('REST: create + assign via the workspace role endpoints', async () => {
    const owner  = await createTestUser({ email: `cr-rest-${Date.now()}@projectflow.test` });
    const member = await createTestUser({ email: `cr-rest-m-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const token = owner.accessToken;

    // Permission ids via the service (the system /admin/permissions is super-admin-gated).
    const perms = await roleService.listPermissions('WORKSPACE');
    const slugId = perms.find((p) => p.slug === 'task.read')!.id;

    const role = (await json<{ data: any }>(await request(`/admin/workspaces/${ws.Id}/roles`, {
      method: 'POST', token, json: { name: 'Triage', permissionIds: [slugId] },
    }), 201)).data;
    expect(role.workspaceId).toBe(ws.Id);

    await json(await request(`/admin/workspaces/${ws.Id}/roles/${role.id}/members`, {
      method: 'POST', token, json: { userId: member.user.Id },
    }), 201);

    const slugs = await roleRepository.getUserPermissionSlugs(member.user.Id, ws.Id);
    expect(slugs.has('task.read')).toBe(true);
  });
});
