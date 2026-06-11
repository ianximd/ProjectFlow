/**
 * Phase 8a — Time Tracking integration coverage.
 * Exercises the timer SPs + REST surface against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// The /tasks create route returns `{ data: <task> }` (verified against
// task.routes.ts + recurrence.integration.test.ts); the task row is PascalCase
// (`.Id`) but read both casings defensively.
const taskIdOf = (t: any): string => String(t.id ?? t.Id);

async function seedTask() {
  const owner = await createTestUser({ email: `wl-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'WL Space', key: `WL${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'T', listId: String(list.id ?? list.Id) },
  }), 201)).data;
  return { token, userId: owner.user.Id, taskId: taskIdOf(task), projectId: space.Id, workspaceId: ws.Id };
}

describe('worklog timer', () => {
  it('start then stop produces a closed entry with a non-null endedAt', async () => {
    const { token, taskId } = await seedTask();
    const started = (await json<{ log: any }>(await request('/worklogs/timer/start', {
      method: 'POST', token, json: { taskId },
    }), 201)).log;
    expect(started.endedAt).toBeNull();
    expect(started.source).toBe('timer');

    const stopped = (await json<{ log: any }>(await request('/worklogs/timer/stop', {
      method: 'POST', token, json: {},
    }))).log;
    expect(stopped.id).toBe(started.id);
    expect(stopped.endedAt).not.toBeNull();
    expect(stopped.timeSpentSeconds).toBeGreaterThanOrEqual(0);
  });

  it('a second start auto-stops the first (one active timer per user)', async () => {
    const { token, taskId } = await seedTask();
    const first  = (await json<{ log: any }>(await request('/worklogs/timer/start', { method: 'POST', token, json: { taskId } }), 201)).log;
    const second = (await json<{ log: any }>(await request('/worklogs/timer/start', { method: 'POST', token, json: { taskId } }), 201)).log;
    expect(second.id).not.toBe(first.id);

    const active = (await json<{ log: any }>(await request('/worklogs/timer/active', { token }))).log;
    expect(active.id).toBe(second.id);

    const list = (await json<{ logs: any[] }>(await request(`/worklogs?taskId=${taskId}`, { token }))).logs;
    const firstRow = list.find((l) => l.id === first.id);
    expect(firstRow.endedAt).not.toBeNull();
  });

  it('billable + tags persist on a manual entry', async () => {
    const { token, taskId, projectId } = await seedTask();
    const tag = (await json<{ data: any }>(await request('/tags', {
      method: 'POST', token, json: { spaceId: projectId, name: 'deep-work', color: '#0ea5e9' },
    }), 201)).data;
    const log = (await json<{ log: any }>(await request('/worklogs', {
      method: 'POST', token,
      json: { taskId, timeSpentSeconds: 1800, startedAt: new Date().toISOString(), billable: true, tagIds: [tag.id] },
    }), 201)).log;
    expect(log.billable).toBe(true);
    expect(log.tags.map((t: any) => t.id)).toContain(tag.id);
  });

  it('rollup sums a subtask into the parent', async () => {
    const { token, taskId, projectId, workspaceId } = await seedTask();
    const child = (await json<{ data: any }>(await request('/tasks', {
      method: 'POST', token, json: { projectId, workspaceId, title: 'child', parentTaskId: taskId },
    }), 201)).data;
    const childId = taskIdOf(child);
    await json(await request('/worklogs', { method: 'POST', token, json: { taskId, timeSpentSeconds: 600, startedAt: new Date().toISOString() } }), 201);
    await json(await request('/worklogs', { method: 'POST', token, json: { taskId: childId, timeSpentSeconds: 900, startedAt: new Date().toISOString() } }), 201);
    await json(await request(`/worklogs/tasks/${taskId}/estimate`, { method: 'PUT', token, json: { estimateSeconds: 3000 } }));

    const rollup = (await json<{ rollup: any }>(await request(`/worklogs/tasks/${taskId}/rollup`, { token }))).rollup;
    expect(rollup.rollupLoggedSeconds).toBe(1500);
    expect(rollup.ownLoggedSeconds).toBe(600);
    expect(rollup.estimateVsActual.estimateSeconds).toBe(3000);
    expect(rollup.estimateVsActual.overBudget).toBe(false);
  });
});
