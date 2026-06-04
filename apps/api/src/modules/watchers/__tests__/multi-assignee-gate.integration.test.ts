import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;
async function setup() {
  seq += 1;
  const owner = await createTestUser({ email: `ma-${Date.now()}-${seq}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'MA Space', key: `MA${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId: list.id ?? list.Id, title: 'MA task' },
  }), 201)).data;
  return { owner, t, ws, space, task };
}

describe('multiple-assignees space gate', () => {
  it('allows 2 assignees by default; 422 once the space toggle is OFF; 1 still allowed', async () => {
    const { owner, t, space, task } = await setup();
    const taskId = task.Id ?? task.id;
    const u1 = owner.user.Id;
    // a second arbitrary id — the gate checks count BEFORE membership filtering.
    const u2 = '22222222-2222-4222-8222-222222222222';

    // Default ON → 2 ids accepted (200).
    const onRes = await request(`/tasks/${taskId}/assignees`, { method: 'PUT', token: t, json: { userIds: [u1, u2] } });
    expect(onRes.status).toBe(200);

    // Turn the space toggle OFF.
    await json(await request(`/projects/${space.Id}`, { method: 'PATCH', token: t, json: { multipleAssignees: false } }), 200);

    // 2 ids now rejected with 422.
    const offRes = await request(`/tasks/${taskId}/assignees`, { method: 'PUT', token: t, json: { userIds: [u1, u2] } });
    expect(offRes.status).toBe(422);
    const body = await offRes.json();
    expect(body.error.code).toBe('MULTIPLE_ASSIGNEES_DISABLED');

    // 1 id still works.
    const oneRes = await request(`/tasks/${taskId}/assignees`, { method: 'PUT', token: t, json: { userIds: [u1] } });
    expect(oneRes.status).toBe(200);
  });
});
