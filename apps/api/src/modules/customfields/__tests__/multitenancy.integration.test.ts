import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('custom fields multitenancy isolation', () => {
  it('user B cannot list custom fields of user A\'s space', async () => {
    const a = await createTestUser({ email: `mt-a-${Date.now()}@projectflow.test` });
    const wsA = await createTestWorkspace(a.accessToken);
    const spaceA = await createTestProject(wsA.Id, a.accessToken, { name: 'A', key: `AAA${Date.now() % 100000}` });
    await json(await request('/custom-fields', { method: 'POST', token: a.accessToken, json: { scopeType: 'SPACE', scopeId: spaceA.Id, type: 'text', name: 'Secret' } }), 201);
    const b = await createTestUser({ email: `mt-b-${Date.now()}@projectflow.test` });
    const res = await request(`/custom-fields?scopeType=SPACE&scopeId=${spaceA.Id}`, { token: b.accessToken });
    expect([403, 404]).toContain(res.status);
  });
});
