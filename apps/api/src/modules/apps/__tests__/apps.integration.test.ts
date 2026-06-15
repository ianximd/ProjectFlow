/**
 * Phase 10a — Apps / feature toggles integration coverage.
 * Disabling Time Tracking at a Space makes the worklog endpoints feature-absent
 * (APP_DISABLED / 404) for tasks beneath it; a sibling Space is unaffected;
 * re-enabling restores. Also asserts the toggle write is gated (fail-closed).
 * DB SAFETY: targets local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// /tasks + /lists both return `{ data: <row> }`; the task row is PascalCase
// (`.Id`) and the list row may be either casing — read both defensively.
const idOf = (r: any): string => String(r.id ?? r.Id);

async function seedSpaceWithTask(workspaceId: string, token: string, key: string) {
  const space = await createTestProject(workspaceId, token, { name: `Space ${key}`, key });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token,
    json: { workspaceId, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token,
    json: { projectId: space.Id, workspaceId, title: 'T', listId: idOf(list) },
  }), 201)).data;
  return { spaceId: space.Id, taskId: idOf(task) };
}

const newWorklog = (taskId: string) => ({
  taskId,
  timeSpentSeconds: 600,
  startedAt: new Date().toISOString(),
});

describe('apps / feature toggles — time_tracking gating', () => {
  it('disable-at-Space → feature-absent for its tasks, sibling intact, re-enable restores', async () => {
    const owner = await createTestUser({ email: `apps-owner-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);

    const a = await seedSpaceWithTask(ws.Id, token, `AA${Date.now() % 100000}`);
    const b = await seedSpaceWithTask(ws.Id, token, `BB${Date.now() % 100000}`);

    // Baseline: both spaces accept a worklog (time_tracking default-on).
    await json(await request('/worklogs', { method: 'POST', token, json: newWorklog(a.taskId) }), 201);
    await json(await request('/worklogs', { method: 'POST', token, json: newWorklog(b.taskId) }), 201);

    // Disable time_tracking at Space A (owner has app.manage + FULL on the space).
    await json(await request(`/apps/space/${a.spaceId}/time_tracking`, {
      method: 'PATCH', token, json: { enabled: false },
    }), 200);

    // Space A's task: worklog write is now feature-absent (404 APP_DISABLED).
    const writeRes = await request('/worklogs', { method: 'POST', token, json: newWorklog(a.taskId) });
    expect(writeRes.status).toBe(404);
    const writeBody = await json<{ error: { code: string } }>(writeRes);
    expect(writeBody.error.code).toBe('APP_DISABLED');

    // Space A's task: read is also feature-absent.
    const readRes = await request(`/worklogs?taskId=${a.taskId}`, { token });
    expect(readRes.status).toBe(404);

    // Sibling Space B is unaffected — still 201.
    await json(await request('/worklogs', { method: 'POST', token, json: newWorklog(b.taskId) }), 201);

    // Clear the override (enabled:null) → restored to the default-on.
    await json(await request(`/apps/space/${a.spaceId}/time_tracking`, {
      method: 'PATCH', token, json: { enabled: null },
    }), 200);
    await json(await request('/worklogs', { method: 'POST', token, json: newWorklog(a.taskId) }), 201);
  });

  it('task-route gate: disabling multiple_assignees at a Space → assignees write is feature-absent (404 APP_DISABLED)', async () => {
    const owner = await createTestUser({ email: `apps-ma-owner-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const s = await seedSpaceWithTask(ws.Id, token, `MA${Date.now() % 100000}`);

    // Baseline: assignees write succeeds (multiple_assignees default-on).
    await json(await request(`/tasks/${s.taskId}/assignees`, {
      method: 'PUT', token, json: { userIds: [owner.user.Id] },
    }), 200);

    // Disable multiple_assignees at the Space.
    await json(await request(`/apps/space/${s.spaceId}/multiple_assignees`, {
      method: 'PATCH', token, json: { enabled: false },
    }), 200);

    // Now the task-route gate short-circuits → 404 APP_DISABLED.
    const res = await request(`/tasks/${s.taskId}/assignees`, {
      method: 'PUT', token, json: { userIds: [owner.user.Id] },
    });
    expect(res.status).toBe(404);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('APP_DISABLED');
  });

  it('fail-closed: a non-member cannot toggle a Space they have no app.manage on', async () => {
    const owner = await createTestUser({ email: `apps-owner2-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const a = await seedSpaceWithTask(ws.Id, token, `CC${Date.now() % 100000}`);

    // A second user with their own token but no membership in `ws`.
    const attacker = await createTestUser({ email: `attacker-${Date.now()}@projectflow.test` });
    await createTestWorkspace(attacker.accessToken); // give them an unrelated workspace

    const res = await request(`/apps/space/${a.spaceId}/time_tracking`, {
      method: 'PATCH', token: attacker.accessToken, json: { enabled: false },
    });
    expect([403, 404]).toContain(res.status);
  });
});
