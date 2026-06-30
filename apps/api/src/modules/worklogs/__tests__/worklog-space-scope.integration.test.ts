/**
 * Regression: work logs must be readable for a list-less (space-scoped) task.
 *
 * A task created directly under a Space has ListId = NULL. The read gate
 * (requireObjectAccess → resolveTaskList) previously resolved ONLY the task's
 * List, so it returned null → 404 "Resource not found" for such tasks — even
 * though requireApp's scope resolver (scopeNodeForTask) correctly falls back to
 * the Space scope. That divergence crashed the WorkLogSection panel.
 *
 * DB SAFETY: targets local Docker ProjectFlow_Test (see globalSetup).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

const taskIdOf = (t: any): string => String(t.id ?? t.Id);

/** A task created directly under a Space (no listId → ListId NULL). */
async function seedSpaceScopedTask() {
  const owner = await createTestUser({ email: `wl-spc-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'WL SpaceOnly', key: `WS${Date.now() % 100000}` });
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'space task' },
  }), 201)).data;
  return { token, taskId: taskIdOf(task) };
}

describe('worklog reads for a list-less (space-scoped) task', () => {
  it('GET /worklogs?taskId= returns 200 (not 404) with an empty log list', async () => {
    const { token, taskId } = await seedSpaceScopedTask();
    const res = await request(`/worklogs?taskId=${taskId}`, { token });
    expect(res.status).toBe(200);
    const body = await json<{ logs: any[]; totals: any[] }>(res);
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it('GET /worklogs/tasks/:taskId/rollup returns 200 (not 404)', async () => {
    const { token, taskId } = await seedSpaceScopedTask();
    const res = await request(`/worklogs/tasks/${taskId}/rollup`, { token });
    expect(res.status).toBe(200);
  });

  it('a manual log created on the space-scoped task is then listed', async () => {
    const { token, taskId } = await seedSpaceScopedTask();
    await json(await request('/worklogs', {
      method: 'POST', token, json: { taskId, timeSpentSeconds: 1200, startedAt: new Date().toISOString() },
    }), 201);
    const body = await json<{ logs: any[] }>(await request(`/worklogs?taskId=${taskId}`, { token }));
    expect(body.logs.length).toBe(1);
    expect(body.logs[0].timeSpentSeconds).toBe(1200);
  });
});
