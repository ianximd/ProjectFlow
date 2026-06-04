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

function expectDenied(r: GqlResult, field: string): void {
  // A denied resolver throws → GraphQL returns an error and a null for that field.
  expect(r.errors, JSON.stringify(r)).toBeDefined();
  expect(r.errors!.length).toBeGreaterThan(0);
  const code = r.errors![0]?.extensions?.code;
  expect(['FORBIDDEN', 'NOT_FOUND', 'UNAUTHENTICATED']).toContain(code);
  expect(r.data?.[field] ?? null).toBeNull();
}

let seq = 0;
async function seedWorkspaceA() {
  seq += 1;
  const a = await createTestUser({ email: `gqlA-${Date.now()}-${seq}@projectflow.test` });
  const t = a.accessToken;
  const ws = await createTestWorkspace(t);
  const space = await createTestProject(ws.Id, t, { name: 'A Space', key: `GA${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  const listId = list.id ?? list.Id;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: t, json: { workspaceId: ws.Id, listId, title: 'A task' },
  }), 201)).data;
  const taskId = task.id ?? task.Id;
  const field = (await json<{ data: any }>(await request('/custom-fields', {
    method: 'POST', token: t, json: { scopeType: 'SPACE', scopeId: space.Id, type: 'text', name: 'A Field' },
  }), 201)).data;
  const tag = (await json<{ data: any }>(await request('/tags', {
    method: 'POST', token: t, json: { spaceId: space.Id, name: 'A Tag', color: '#aabbcc' },
  }), 201)).data;
  const types = (await json<{ data: any[] }>(await request(`/task-types?workspaceId=${ws.Id}`, { token: t }), 200)).data;
  return { a, t, ws, space, listId, taskId, fieldId: field.id ?? field.Id, tagId: tag.id ?? tag.Id, typeId: types[0].id ?? types[0].Id };
}

describe('GraphQL authz — cross-tenant isolation', () => {
  it('denies every Phase 2 resolver to a non-member', async () => {
    const A = await seedWorkspaceA();
    const b = await createTestUser({ email: `gqlB-${Date.now()}@projectflow.test` });
    const tb = b.accessToken; // member of nothing in workspace A

    // ── Queries (reads) ──
    expectDenied(await gql('query($s:String!){spaceTags(spaceId:$s){id}}', { s: A.space.Id }, tb), 'spaceTags');
    expectDenied(await gql('query($w:String!){taskTypes(workspaceId:$w){id}}', { w: A.ws.Id }, tb), 'taskTypes');
    expectDenied(await gql('query($t:String!){taskWatchers(taskId:$t){userId}}', { t: A.taskId }, tb), 'taskWatchers');
    expectDenied(await gql('query($st:String!,$si:String!){customFields(scopeType:$st,scopeId:$si){id}}', { st: 'SPACE', si: A.space.Id }, tb), 'customFields');
    expectDenied(await gql('query($t:String!){taskEffectiveFields(taskId:$t){value}}', { t: A.taskId }, tb), 'taskEffectiveFields');

    // ── Mutations (writes) ──
    expectDenied(await gql('mutation($s:String!,$n:String!){createTag(spaceId:$s,name:$n){id}}', { s: A.space.Id, n: 'evil' }, tb), 'createTag');
    expectDenied(await gql('mutation($id:String!){deleteTag(id:$id)}', { id: A.tagId }, tb), 'deleteTag');
    expectDenied(await gql('mutation($t:String!,$g:String!){linkTag(taskId:$t,tagId:$g)}', { t: A.taskId, g: A.tagId }, tb), 'linkTag');
    expectDenied(await gql('mutation($t:String!,$g:String!){unlinkTag(taskId:$t,tagId:$g)}', { t: A.taskId, g: A.tagId }, tb), 'unlinkTag');
    expectDenied(await gql('mutation($t:String!,$ty:String!){setTaskType(taskId:$t,taskTypeId:$ty)}', { t: A.taskId, ty: A.typeId }, tb), 'setTaskType');
    expectDenied(await gql('mutation($t:String!,$u:String!){addWatcher(taskId:$t,userId:$u)}', { t: A.taskId, u: b.user.Id }, tb), 'addWatcher');
    expectDenied(await gql('mutation($t:String!,$u:String!){removeWatcher(taskId:$t,userId:$u)}', { t: A.taskId, u: b.user.Id }, tb), 'removeWatcher');
    expectDenied(await gql('mutation($t:String!,$f:String!,$v:String){setTaskCustomField(taskId:$t,fieldId:$f,value:$v){value}}', { t: A.taskId, f: A.fieldId, v: '"x"' }, tb), 'setTaskCustomField');

    // ── Side-effect proof: nothing B attempted actually landed ──
    const tags = (await json<{ data: any[] }>(await request(`/tags?spaceId=${A.space.Id}`, { token: A.t }), 200)).data;
    expect(tags.map((x) => x.name)).not.toContain('evil');
    const watchers = (await json<{ data: any[] }>(await request(`/tasks/${A.taskId}/watchers`, { token: A.t }), 200)).data;
    expect(watchers).toHaveLength(0);
  });

  it('allows the workspace owner through GraphQL (no over-blocking)', async () => {
    const A = await seedWorkspaceA();
    const ok = await gql('query($w:String!){taskTypes(workspaceId:$w){id}}', { w: A.ws.Id }, A.t);
    expect(ok.errors, JSON.stringify(ok)).toBeUndefined();
    expect(Array.isArray(ok.data?.taskTypes)).toBe(true);

    const tagOk = await gql('mutation($s:String!,$n:String!){createTag(spaceId:$s,name:$n){id name}}', { s: A.space.Id, n: 'owner-tag' }, A.t);
    expect(tagOk.errors, JSON.stringify(tagOk)).toBeUndefined();
    expect(tagOk.data?.createTag?.name).toBe('owner-tag');

    const linkOk = await gql('mutation($t:String!,$g:String!){linkTag(taskId:$t,tagId:$g)}', { t: A.taskId, g: A.tagId }, A.t);
    expect(linkOk.errors, JSON.stringify(linkOk)).toBeUndefined();
    expect(linkOk.data?.linkTag).toBe(true);
  });
});
