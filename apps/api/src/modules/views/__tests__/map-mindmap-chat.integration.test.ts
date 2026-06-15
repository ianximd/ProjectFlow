/**
 * Phase 9f — Map / Mind Map / Chat integration coverage.
 * Exercises the new view resolvers against the REAL SQL + GraphQL stack:
 *  - mapTasks returns ONLY tasks carrying a valid `location` value in scope
 *    (set via the real REST custom-field create + value-set → location validator),
 *  - mindMapGraph returns the parent→child subtree under the scope node,
 *  - postChatMessage creates a REAL comment that chatChannel + REST then stream,
 *  - all four resolvers DENY a non-member (cross-tenant fail-closed).
 * DB SAFETY: must target local Docker ProjectFlow_Test (never apps/api/.env prod).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';

interface GqlResult { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] }
async function gql(token: string, query: string, variables: Record<string, unknown>): Promise<GqlResult> {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as GqlResult;
}

const emptyConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] });
const idOf = (o: any): string => o.id ?? o.Id;

async function createList(token: string, workspaceId: string, spaceId: string): Promise<any> {
  return (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId, spaceId, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
}
async function createTask(
  token: string, projectId: string, workspaceId: string, listId: string, title: string, parentTaskId?: string,
): Promise<any> {
  return (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token,
    json: { projectId, workspaceId, title, listId, ...(parentTaskId ? { parentTaskId } : {}) },
  }), 201)).data;
}
async function createLocationField(token: string, spaceId: string): Promise<any> {
  return (await json<{ data: any }>(await request('/custom-fields', {
    method: 'POST', token, json: { scopeType: 'SPACE', scopeId: spaceId, type: 'location', name: 'Office' },
  }), 201)).data;
}
async function createView(token: string, spaceId: string, type: string): Promise<string> {
  const r = await gql(token,
    `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id } }`,
    { input: { scopeType: 'SPACE', scopeId: spaceId, type, name: type, isShared: true, isDefault: false, config: emptyConfig } });
  if (r.errors) throw new Error(`createView ${type}: ${JSON.stringify(r.errors)}`);
  return r.data!.createSavedView.id;
}

async function seedScope() {
  const owner = await createTestUser();
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Map Space' });
  const list = await createList(token, ws.Id, space.Id);
  return { owner, token, ws, space, list };
}

describe('Phase 9f — Map / Mind Map / Chat', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('mapTasks returns ONLY tasks with a valid location value in scope', async () => {
    const { token, ws, space, list } = await seedScope();
    const located = await createTask(token, space.Id, ws.Id, idOf(list), 'HQ');
    const plain = await createTask(token, space.Id, ws.Id, idOf(list), 'No location');
    const field = await createLocationField(token, space.Id);

    // Set the located task's location via the real value route (→ location validator).
    const put = await request(`/tasks/${idOf(located)}/fields/${idOf(field)}`, {
      method: 'PUT', token, json: { value: { lat: -6.2, lng: 106.8, label: 'Jakarta' } },
    });
    expect(put.status).toBe(200);

    const viewId = await createView(token, space.Id, 'map');
    const res = await gql(token, `query($id: String!){ mapTasks(viewId: $id){ taskId title lat lng label } }`, { id: viewId });
    expect(res.errors, JSON.stringify(res)).toBeUndefined();
    const pins = res.data!.mapTasks as any[];
    const ids = pins.map((p) => String(p.taskId).toLowerCase());
    expect(ids).toContain(String(idOf(located)).toLowerCase());
    expect(ids).not.toContain(String(idOf(plain)).toLowerCase());
    const hq = pins.find((p) => String(p.taskId).toLowerCase() === String(idOf(located)).toLowerCase())!;
    expect(hq.lat).toBeCloseTo(-6.2, 5);
    expect(hq.lng).toBeCloseTo(106.8, 5);
    expect(hq.label).toBe('Jakarta');
  });

  it('mindMapGraph returns the parent→child subtree under the scope', async () => {
    const { token, ws, space, list } = await seedScope();
    const parent = await createTask(token, space.Id, ws.Id, idOf(list), 'Parent');
    const child = await createTask(token, space.Id, ws.Id, idOf(list), 'Child', idOf(parent));

    const viewId = await createView(token, space.Id, 'mindmap');
    const res = await gql(token,
      `query($id: String!){ mindMapGraph(viewId: $id){ nodes { id depth parentId } edges { from to } rootIds } }`, { id: viewId });
    expect(res.errors, JSON.stringify(res)).toBeUndefined();
    const g = res.data!.mindMapGraph;
    const low = (s: string) => String(s).toLowerCase();
    expect(g.rootIds.map(low)).toContain(low(idOf(parent)));
    expect(g.edges.map((e: any) => ({ from: low(e.from), to: low(e.to) })))
      .toContainEqual({ from: low(idOf(parent)), to: low(idOf(child)) });
    const childNode = g.nodes.find((n: any) => low(n.id) === low(idOf(child)));
    expect(childNode.depth).toBe(1);
  });

  it('postChatMessage creates a real comment that chatChannel + REST then stream', async () => {
    const { token, ws, space, list } = await seedScope();
    const task = await createTask(token, space.Id, ws.Id, idOf(list), 'Chatty');

    const posted = await gql(token,
      `mutation($t: String!, $b: String!){ postChatMessage(taskId: $t, body: $b){ id taskId body } }`,
      { t: idOf(task), b: 'hello channel' });
    expect(posted.errors, JSON.stringify(posted)).toBeUndefined();
    const msg = posted.data!.postChatMessage;
    expect(msg.body).toBe('hello channel');

    // It is a real comment — visible on the REST comment list.
    const comments = (await json<{ data: any[] }>(await request(`/comments?taskId=${idOf(task)}`, { token }), 200)).data;
    expect(comments.map((c) => c.id)).toContain(msg.id);

    // And streamed by chatChannel.
    const channel = await gql(token, `query($t: String!){ chatChannel(taskId: $t){ id body } }`, { t: idOf(task) });
    expect(channel.errors, JSON.stringify(channel)).toBeUndefined();
    expect((channel.data!.chatChannel as any[]).map((m) => m.id)).toContain(msg.id);
  });

  it('denies all four resolvers to a non-member (cross-tenant fail-closed)', async () => {
    const { token, ws, space, list } = await seedScope();
    const located = await createTask(token, space.Id, ws.Id, idOf(list), 'HQ');
    const field = await createLocationField(token, space.Id);
    await request(`/tasks/${idOf(located)}/fields/${idOf(field)}`, {
      method: 'PUT', token, json: { value: { lat: 1, lng: 2, label: 'x' } },
    });
    const mapViewId = await createView(token, space.Id, 'map');
    const mindViewId = await createView(token, space.Id, 'mindmap');

    const b = await createTestUser({ email: `mmcB-${Date.now()}@projectflow.test` });
    const DENY = ['FORBIDDEN', 'NOT_FOUND', 'UNAUTHENTICATED'];

    const map = await gql(b.accessToken, `query($id: String!){ mapTasks(viewId: $id){ taskId } }`, { id: mapViewId });
    expect(map.errors, JSON.stringify(map)).toBeDefined();
    expect(DENY).toContain(map.errors![0]?.extensions?.code);
    expect(map.data?.mapTasks ?? null).toBeNull();

    const mind = await gql(b.accessToken, `query($id: String!){ mindMapGraph(viewId: $id){ rootIds } }`, { id: mindViewId });
    expect(mind.errors, JSON.stringify(mind)).toBeDefined();
    expect(DENY).toContain(mind.errors![0]?.extensions?.code);
    expect(mind.data?.mindMapGraph ?? null).toBeNull();

    const channel = await gql(b.accessToken, `query($t: String!){ chatChannel(taskId: $t){ id } }`, { t: idOf(located) });
    expect(channel.errors, JSON.stringify(channel)).toBeDefined();
    expect(DENY).toContain(channel.errors![0]?.extensions?.code);
    expect(channel.data?.chatChannel ?? null).toBeNull();

    const post = await gql(b.accessToken,
      `mutation($t: String!, $b: String!){ postChatMessage(taskId: $t, body: $b){ id } }`,
      { t: idOf(located), b: 'intruder' });
    expect(post.errors, JSON.stringify(post)).toBeDefined();
    expect(DENY).toContain(post.errors![0]?.extensions?.code);
    expect(post.data?.postChatMessage ?? null).toBeNull();
  });
});
