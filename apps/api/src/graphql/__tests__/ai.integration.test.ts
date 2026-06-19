/**
 * Phase 11b — aiAsk GraphQL mirror integration test.
 *
 *   - Owner runs aiAsk → returns { answer, citations[] } citing the public task.
 *   - A non-member is denied (FORBIDDEN), proving the ai.use workspace gate fires
 *     on the GraphQL surface exactly as on REST.
 *
 * Corpus seeded via POST /dev/ai/reindex. Deterministic via FakeProvider.
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../__tests__/setup/testServer.js';
import { truncateAll } from '../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../__tests__/fixtures/factories.js';
import { closePool } from '../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

interface GqlResult { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] }
async function gql(query: string, variables: Record<string, unknown>, token?: string): Promise<GqlResult> {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as GqlResult;
}

const ASK = `query($w:String!,$q:String!){ aiAsk(workspaceId:$w, question:$q){ answer citations{ objectType objectId } } }`;

async function seed() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const key5 = (p: string) => `${p}${stamp.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}`;
  const owner = await createTestUser({ email: `gql-ask-owner-${stamp}@projectflow.test` });
  const t = owner.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'Open', key: key5('OP') });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Public', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 'Team lunch friday', description: 'lunch plans for friday downtown', type: 'TASK' },
  }), 201)).data;
  const lunchTaskId = task.id ?? task.Id;
  await json(await request('/dev/ai/reindex', { method: 'POST', token: t, json: { workspaceId: ws.Id } }), 200);
  return { t, wsId: ws.Id, lunchTaskId };
}

describe('GraphQL aiAsk', () => {
  it('owner gets an answer + citations citing the public task', async () => {
    const s = await seed();
    const r = await gql(ASK, { w: s.wsId, q: 'what are the lunch plans friday downtown?' }, s.t);
    expect(r.errors, JSON.stringify(r)).toBeUndefined();
    expect(typeof r.data?.aiAsk?.answer).toBe('string');
    const citedIds = (r.data?.aiAsk?.citations ?? []).map((c: any) => String(c.objectId).toLowerCase());
    expect(citedIds).toContain(s.lunchTaskId.toLowerCase());
  });

  it('denies a non-member (FORBIDDEN)', async () => {
    const s = await seed();
    const outsider = await createTestUser({ email: `gql-ask-out-${Date.now()}@projectflow.test` });
    const r = await gql(ASK, { w: s.wsId, q: 'lunch?' }, outsider.accessToken);
    expect(r.errors, JSON.stringify(r)).toBeDefined();
    expect(['FORBIDDEN', 'NOT_FOUND', 'UNAUTHENTICATED']).toContain(r.errors![0]?.extensions?.code);
    expect(r.data?.aiAsk ?? null).toBeNull();
  });
});
