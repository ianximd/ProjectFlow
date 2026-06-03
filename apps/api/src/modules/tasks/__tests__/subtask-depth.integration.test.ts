import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('subtask depth limit (Space.MaxSubtaskDepth)', () => {
  it('allows nesting within the limit and rejects over-limit creation with 422', async () => {
    const owner = await createTestUser({ email: `depth-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Depth', key: `DPT${Date.now() % 10000}` });
    const t = owner.accessToken;

    // MaxSubtaskDepth = 1 → root + one level of subtask allowed; grandchild rejected.
    await request(`/projects/${space.Id}`, { method: 'PATCH', token: t, json: { maxSubtaskDepth: 1 } });

    const list = (await json<{ data: any }>(await request('/lists', {
      method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
    }), 201)).data;

    const root = (await json<{ data: any }>(await request('/tasks', {
      method: 'POST', token: t, json: { title: 'root', listId: list.Id, workspaceId: ws.Id },
    }), 201)).data;

    const child = (await json<{ data: any }>(await request('/tasks', {
      method: 'POST', token: t, json: { title: 'child', listId: list.Id, workspaceId: ws.Id, parentTaskId: root.Id },
    }), 201)).data;

    // Grandchild exceeds MaxSubtaskDepth=1 → SP THROW 51230 → route 422.
    const grandchild = await request('/tasks', {
      method: 'POST', token: t, json: { title: 'grandchild', listId: list.Id, workspaceId: ws.Id, parentTaskId: child.Id },
    });
    expect(grandchild.status).toBe(422);
  });
});
