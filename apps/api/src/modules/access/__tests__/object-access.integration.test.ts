import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('private space access', () => {
  it('owner gets 200, non-member gets 403 on a PRIVATE space subtree', async () => {
    const owner = await createTestUser({ email: `acc-owner-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'Private', key: `PRV${Date.now() % 10000}` });

    await request(`/projects/${space.Id}`, { method: 'PATCH', token: owner.accessToken, json: { visibility: 'PRIVATE' } });

    const ownerRes = await request(`/folders?spaceId=${space.Id}`, { token: owner.accessToken });
    expect(ownerRes.status).toBe(200);

    const stranger = await createTestUser({ email: `acc-stranger-${Date.now()}@projectflow.test` });
    const strangerRes = await request(`/folders?spaceId=${space.Id}`, { token: stranger.accessToken });
    expect(strangerRes.status).toBe(403);
  });
});
