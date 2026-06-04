import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('tags multitenancy isolation', () => {
  it("user B cannot list or create tags in user A's space", async () => {
    const a = await createTestUser({ email: `tag-mt-a-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(a.accessToken);
    const spaceA = await createTestProject(wsA.Id, a.accessToken, { name: 'A', key: `TGA${Date.now() % 100000}` });
    await json(await request('/tags', { method: 'POST', token: a.accessToken, json: { spaceId: spaceA.Id, name: 'secret' } }), 201);

    const b = await createTestUser({ email: `tag-mt-b-${Date.now()}@projectflow.test` });
    const listRes = await request(`/tags?spaceId=${spaceA.Id}`, { token: b.accessToken });
    expect([403, 404]).toContain(listRes.status);
    const createRes = await request('/tags', { method: 'POST', token: b.accessToken, json: { spaceId: spaceA.Id, name: 'intrusion' } });
    expect([403, 404]).toContain(createRes.status);
  });
});
