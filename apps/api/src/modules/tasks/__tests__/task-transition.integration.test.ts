/**
 * Task transitions go through `usp_Task_Transition`, which validates
 * against a project workflow only when one is attached. Without a
 * workflow, any transition is permitted. With a workflow, illegal
 * transitions throw at the SP layer.
 *
 * This file covers the route boundary:
 *   - happy-path transition (no workflow attached → free movement)
 *   - non-existent task → 404
 *   - permission gate (`task.transition`) — viewer is rejected
 *   - unauthenticated request — 401
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import {
  createTestUser,
  createTestWorkspace,
  createTestProject,
  createTestTask,
} from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll  (async () => { await closePool();   });

describe('PATCH /tasks/:id/transition', () => {
  it('moves a task between statuses when no workflow constrains it', async () => {
    const owner   = await createTestUser({ email: 'tt-owner@projectflow.test' });
    const ws      = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

    expect(task.Status).toBe('To Do');

    const moved = await request(`/tasks/${task.Id}/transition`, {
      method: 'PATCH',
      token:  owner.accessToken,
      json:   { status: 'In Progress' },
    });
    const body = await json<{ data: { Status: string } }>(moved, 200);
    expect(body.data.Status).toBe('In Progress');

    // A second transition to a third status also works — confirms the
    // "no workflow → free transitions" branch.
    const movedAgain = await request(`/tasks/${task.Id}/transition`, {
      method: 'PATCH',
      token:  owner.accessToken,
      json:   { status: 'Done' },
    });
    const body2 = await json<{ data: { Status: string } }>(movedAgain, 200);
    expect(body2.data.Status).toBe('Done');
  });

  it('returns 404 when the task id is unknown', async () => {
    const owner = await createTestUser({ email: 'tt-404@projectflow.test' });
    const fake  = '00000000-0000-0000-0000-000000000000';

    const res = await request(`/tasks/${fake}/transition`, {
      method: 'PATCH',
      token:  owner.accessToken,
      json:   { status: 'In Progress' },
    });

    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const owner   = await createTestUser({ email: 'tt-noauth@projectflow.test' });
    const ws      = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

    const res = await request(`/tasks/${task.Id}/transition`, {
      method: 'PATCH',
      json:   { status: 'In Progress' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a viewer (no task.transition perm) with 403', async () => {
    const owner   = await createTestUser({ email: 'tt-viewer-owner@projectflow.test' });
    const ws      = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

    const viewer = await createTestUser({ email: 'tt-viewer@projectflow.test' });

    // Invite viewer with the workspace-viewer role.
    const invite = await request(`/workspaces/${ws.Id}/members/by-email`, {
      method: 'POST',
      token:  owner.accessToken,
      json:   { email: viewer.user.Email, role: 'VIEWER' },
    });
    expect(invite.status).toBe(201);

    const res = await request(`/tasks/${task.Id}/transition`, {
      method: 'PATCH',
      token:  viewer.accessToken,
      json:   { status: 'In Progress' },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect((body as any).error?.code).toBe('FORBIDDEN');
  });

  it('persists the new status to the DB (not just the response)', async () => {
    const owner   = await createTestUser({ email: 'tt-persist@projectflow.test' });
    const ws      = await createTestWorkspace(owner.accessToken);
    const project = await createTestProject(ws.Id, owner.accessToken);
    const task    = await createTestTask(project.Id, ws.Id, owner.accessToken);

    await request(`/tasks/${task.Id}/transition`, {
      method: 'PATCH',
      token:  owner.accessToken,
      json:   { status: 'In Progress' },
    });

    const pool = await getPool();
    const result = await pool.request()
      .input('Id', task.Id)
      .query('SELECT Status FROM dbo.Tasks WHERE Id = @Id');
    expect(result.recordset[0]?.Status).toBe('In Progress');
  });
});
