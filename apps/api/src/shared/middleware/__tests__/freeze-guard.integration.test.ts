/**
 * Phase 6 W43 — freeze guard
 *
 * The unit test pins the middleware branches with a mocked repo. This file
 * pins the full path against MSSQL: workspace.Status = 'FROZEN' really
 * blocks writes at the HTTP boundary, real admin slug really bypasses,
 * and reads stay open. Without this, a regression that bypasses the
 * permission middleware (or skips the SP) wouldn't show up in unit tests.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import {
  createTestUser,
  createTestWorkspace,
  createTestProject,
} from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

// Direct SP call — going through the admin HTTP route would also work but
// would double the cost (auth + workspace lookup + audit-log write per
// test) for a knob the test only needs to flip.
async function setWorkspaceStatus(id: string, status: 'ACTIVE' | 'TRIAL' | 'FROZEN' | 'SUSPENDED') {
  const pool = await getPool();
  await pool.request()
    .input('Id', id)
    .input('Status', status)
    .execute('usp_Workspace_SetStatus');
}

beforeEach(async () => { await truncateAll(); });
afterAll  (async () => { await closePool();   });

describe('freeze guard — workspace.Status blocks workspace-scoped writes', () => {
  it('a FROZEN workspace refuses POST /projects with 403 WORKSPACE_FROZEN', async () => {
    const owner = await createTestUser({ email: 'fz-owner-1@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);

    await setWorkspaceStatus(ws.Id, 'FROZEN');

    const res = await request('/projects', {
      method: 'POST',
      token:  owner.accessToken,
      json:   { workspaceId: ws.Id, name: 'Blocked', key: 'BLK', type: 'KANBAN' },
    });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error?.code).toBe('WORKSPACE_FROZEN');
  });

  it('a SUSPENDED workspace refuses writes with 403 WORKSPACE_SUSPENDED', async () => {
    const owner = await createTestUser({ email: 'fz-owner-2@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);

    await setWorkspaceStatus(ws.Id, 'SUSPENDED');

    const res = await request('/projects', {
      method: 'POST',
      token:  owner.accessToken,
      json:   { workspaceId: ws.Id, name: 'Blocked', key: 'BL2', type: 'KANBAN' },
    });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error?.code).toBe('WORKSPACE_SUSPENDED');
  });

  it('reads against a FROZEN workspace still succeed — only writes are blocked', async () => {
    const owner = await createTestUser({ email: 'fz-owner-3@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);
    await createTestProject(ws.Id, owner.accessToken, { name: 'Existing', key: 'EXI' });

    await setWorkspaceStatus(ws.Id, 'FROZEN');

    const res = await request(`/projects?workspaceId=${ws.Id}`, {
      token: owner.accessToken,
    });
    expect(res.status).toBe(200);
  });

  it('thawing a workspace back to ACTIVE restores write access — no caching surprises', async () => {
    const owner = await createTestUser({ email: 'fz-owner-4@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);

    await setWorkspaceStatus(ws.Id, 'FROZEN');
    const blocked = await request('/projects', {
      method: 'POST',
      token:  owner.accessToken,
      json:   { workspaceId: ws.Id, name: 'Blocked', key: 'BL3', type: 'KANBAN' },
    });
    expect(blocked.status).toBe(403);

    await setWorkspaceStatus(ws.Id, 'ACTIVE');
    const ok = await request('/projects', {
      method: 'POST',
      token:  owner.accessToken,
      json:   { workspaceId: ws.Id, name: 'Allowed', key: 'OK1', type: 'KANBAN' },
    });
    expect(ok.status).toBe(201);
  });

  it('a super-admin bypasses the freeze guard — admins can act on frozen workspaces', async () => {
    // Without this bypass an admin couldn't soft-delete a frozen workspace
    // through the public API — they'd have to go straight to the DB.
    // DELETE /workspaces/:id accepts admin.workspaces.delete (system-scoped),
    // which super-admin holds, AND must bypass the freeze guard via the
    // admin.workspaces.* prefix check.
    const owner = await createTestUser({ email: 'fz-owner-5@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);
    const admin = await createTestUser({ email: 'fz-admin-5@projectflow.test', systemRole: 'super-admin' });

    await setWorkspaceStatus(ws.Id, 'FROZEN');

    const res = await request(`/workspaces/${ws.Id}`, {
      method: 'DELETE',
      token:  admin.accessToken,
    });
    // 204 means the freeze guard let the admin through. 403 means the
    // bypass broke.
    expect(res.status).toBe(204);
  });
});
