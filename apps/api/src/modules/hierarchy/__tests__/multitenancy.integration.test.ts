import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('hierarchy multitenancy isolation', () => {
  it('a user in workspace B cannot read folders of a space in workspace A', async () => {
    const a = await createTestUser({ email: `mt-a-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(a.accessToken);
    const spaceA = await createTestProject(wsA.Id, a.accessToken, { name: 'A', key: `AAA${Date.now() % 10000}` });
    await request('/folders', { method: 'POST', token: a.accessToken, json: { workspaceId: wsA.Id, spaceId: spaceA.Id, name: 'secret', position: 0 } });

    const b = await createTestUser({ email: `mt-b-${Date.now()}@projectflow.test` });
    const res = await request(`/folders?spaceId=${spaceA.Id}`, { token: b.accessToken });
    expect([403, 404]).toContain(res.status);
  });
});
