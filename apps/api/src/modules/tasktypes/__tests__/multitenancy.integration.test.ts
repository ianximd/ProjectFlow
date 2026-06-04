import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('task types multitenancy isolation', () => {
  it("user B cannot list task types of user A's workspace", async () => {
    const a = await createTestUser({ email: `tt-mt-a-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(a.accessToken);
    // sanity: A can list
    await json(await request(`/task-types?workspaceId=${wsA.Id}`, { token: a.accessToken }), 200);

    const b = await createTestUser({ email: `tt-mt-b-${Date.now()}@projectflow.test` });
    const res = await request(`/task-types?workspaceId=${wsA.Id}`, { token: b.accessToken });
    expect([403, 404]).toContain(res.status);
  });
});
