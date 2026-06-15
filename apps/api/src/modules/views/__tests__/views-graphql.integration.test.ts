import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';

interface GqlResult { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] }
async function gql(token: string, query: string, variables: Record<string, unknown>): Promise<GqlResult> {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as GqlResult;
}
async function setListPath(id: string, lp: string): Promise<void> {
  const pool = await getPool();
  await pool.request().input('Id', id).input('LP', lp).query('UPDATE Tasks SET ListPath=@LP WHERE Id=@Id');
}

const emptyConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] });

describe('Views GraphQL', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('creates a saved view and runs it (tasks { title } resolves)', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'gql' });
    await setListPath(t.Id, `/${p.Id}/`);

    const create = await gql(u.accessToken,
      `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id name type scopeType isShared } }`,
      { input: { scopeType: 'SPACE', scopeId: p.Id, type: 'table', name: 'V', isShared: true, isDefault: false, config: emptyConfig } });
    expect(create.errors, JSON.stringify(create)).toBeUndefined();
    expect(create.data!.createSavedView.name).toBe('V');
    const viewId = create.data!.createSavedView.id;

    const run = await gql(u.accessToken,
      `query($id: String!){ viewTasks(viewId: $id, page: 1){ total tasks { title } } }`, { id: viewId });
    expect(run.errors, JSON.stringify(run)).toBeUndefined();
    expect(run.data!.viewTasks.total).toBeGreaterThanOrEqual(1);
    expect(run.data!.viewTasks.tasks.map((x: any) => x.title)).toContain('gql');
  });

  it('lists saved views and previews a config without saving', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'prev' });
    await setListPath(t.Id, `/${p.Id}/`);

    await gql(u.accessToken,
      `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id } }`,
      { input: { scopeType: 'SPACE', scopeId: p.Id, type: 'table', name: 'Saved', isShared: true, isDefault: false, config: emptyConfig } });

    const listed = await gql(u.accessToken,
      `query($st:String!,$si:String!){ savedViews(scopeType:$st, scopeId:$si){ id name } }`, { st: 'SPACE', si: p.Id });
    expect(listed.errors, JSON.stringify(listed)).toBeUndefined();
    expect(listed.data!.savedViews.map((v: any) => v.name)).toContain('Saved');

    const preview = await gql(u.accessToken,
      `query($st:String!,$si:String!,$c:String!){ previewViewTasks(scopeType:$st, scopeId:$si, config:$c, page:1){ total tasks { title } } }`,
      { st: 'SPACE', si: p.Id, c: emptyConfig });
    expect(preview.errors, JSON.stringify(preview)).toBeUndefined();
    expect(preview.data!.previewViewTasks.tasks.map((x: any) => x.title)).toContain('prev');
  });

  it('denies viewTasks to a non-member (cross-tenant)', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);
    const t = await createTestTask(p.Id, ws.Id, u.accessToken, { title: 'secret' });
    await setListPath(t.Id, `/${p.Id}/`);

    const create = await gql(u.accessToken,
      `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id } }`,
      { input: { scopeType: 'SPACE', scopeId: p.Id, type: 'table', name: 'V', isShared: true, isDefault: false, config: emptyConfig } });
    const viewId = create.data!.createSavedView.id;

    const b = await createTestUser({ email: `viewsB-${Date.now()}@projectflow.test` });
    const run = await gql(b.accessToken, `query($id: String!){ viewTasks(viewId: $id, page: 1){ total } }`, { id: viewId });
    expect(run.errors, JSON.stringify(run)).toBeDefined();
    expect(['FORBIDDEN', 'NOT_FOUND', 'UNAUTHENTICATED']).toContain(run.errors![0]?.extensions?.code);
    expect(run.data?.viewTasks ?? null).toBeNull();
  });

  it('denies EVERYTHING savedViews to a non-member (cross-tenant)', async () => {
    const a = await createTestUser();
    const ws = await createTestWorkspace(a.accessToken);

    // user A creates a shared EVERYTHING view in their workspace
    const create = await gql(a.accessToken,
      `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id } }`,
      { input: { scopeType: 'EVERYTHING', type: 'table', name: 'WS', isShared: true, isDefault: false, config: emptyConfig, workspaceId: ws.Id } });
    expect(create.errors, JSON.stringify(create)).toBeUndefined();

    // user B, a non-member of A's workspace, must not be able to list them
    const b = await createTestUser({ email: `viewsEvery-${Date.now()}@projectflow.test` });
    const listed = await gql(b.accessToken,
      `query($st:String!,$ws:String!){ savedViews(scopeType:$st, workspaceId:$ws){ id name } }`,
      { st: 'EVERYTHING', ws: ws.Id });
    expect(listed.errors, JSON.stringify(listed)).toBeDefined();
    expect(['FORBIDDEN', 'NOT_FOUND', 'UNAUTHENTICATED']).toContain(listed.errors![0]?.extensions?.code);
    expect(listed.data?.savedViews ?? null).toBeNull();
  });

  it('rejects an invalid view type with a clean error (no 500)', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);

    const create = await gql(u.accessToken,
      `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id } }`,
      { input: { scopeType: 'SPACE', scopeId: p.Id, type: 'nonsense', name: 'Bad', isShared: false, isDefault: false, config: emptyConfig } });
    expect(create.errors, JSON.stringify(create)).toBeDefined();
    expect(create.errors![0]?.extensions?.code).not.toBe('INTERNAL_SERVER_ERROR');
    expect(create.data?.createSavedView ?? null).toBeNull();
  });

  it('rejects an embed view with a javascript: URL (EmbedUrlError → BAD_USER_INPUT, no row created)', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);

    const badConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [], url: 'javascript:alert(1)' });
    const create = await gql(u.accessToken,
      `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id config } }`,
      { input: { scopeType: 'SPACE', scopeId: p.Id, type: 'embed', name: 'Bad', isShared: false, isDefault: false, config: badConfig } });
    expect(create.errors, JSON.stringify(create)).toBeDefined();
    expect(create.errors![0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(create.data?.createSavedView ?? null).toBeNull();
  });

  it('creates an embed view with a valid https URL and stores the normalized URL', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);

    // Include a fragment to verify it is stripped by normalizeEmbedUrl.
    const goodConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [], url: 'https://example.com/x#fragment' });
    const create = await gql(u.accessToken,
      `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id config } }`,
      { input: { scopeType: 'SPACE', scopeId: p.Id, type: 'embed', name: 'Embed', isShared: false, isDefault: false, config: goodConfig } });
    expect(create.errors, JSON.stringify(create)).toBeUndefined();
    const viewId = create.data!.createSavedView.id;
    // The stored config.url must be the normalized form (fragment stripped).
    const stored = JSON.parse(create.data!.createSavedView.config) as { url: string };
    expect(stored.url).toBe('https://example.com/x');

    // Reading back via savedViews confirms the persisted value.
    const listed = await gql(u.accessToken,
      `query($st:String!,$si:String!){ savedViews(scopeType:$st, scopeId:$si){ id config } }`,
      { st: 'SPACE', si: p.Id });
    expect(listed.errors, JSON.stringify(listed)).toBeUndefined();
    const found = (listed.data!.savedViews as any[]).find((v: any) => v.id === viewId);
    expect(found).toBeDefined();
    expect(JSON.parse(found.config).url).toBe('https://example.com/x');
  });

  it('updates, reorders and deletes a saved view', async () => {
    const u = await createTestUser();
    const ws = await createTestWorkspace(u.accessToken);
    const p = await createTestProject(ws.Id, u.accessToken);

    const create = await gql(u.accessToken,
      `mutation($input: CreateSavedViewInput!){ createSavedView(input: $input){ id position } }`,
      { input: { scopeType: 'SPACE', scopeId: p.Id, type: 'table', name: 'Orig', isShared: false, isDefault: false, config: emptyConfig } });
    const viewId = create.data!.createSavedView.id;

    const upd = await gql(u.accessToken,
      `mutation($id:String!,$input:UpdateSavedViewInput!){ updateSavedView(id:$id, input:$input){ id name isShared } }`,
      { id: viewId, input: { name: 'Renamed', isShared: true } });
    expect(upd.errors, JSON.stringify(upd)).toBeUndefined();
    expect(upd.data!.updateSavedView.name).toBe('Renamed');
    expect(upd.data!.updateSavedView.isShared).toBe(true);

    const reo = await gql(u.accessToken,
      `mutation($id:String!,$pos:Float!){ reorderSavedView(id:$id, position:$pos){ id position } }`, { id: viewId, pos: 42 });
    expect(reo.errors, JSON.stringify(reo)).toBeUndefined();
    expect(reo.data!.reorderSavedView.position).toBe(42);

    const del = await gql(u.accessToken, `mutation($id:String!){ deleteSavedView(id:$id){ id } }`, { id: viewId });
    expect(del.errors, JSON.stringify(del)).toBeUndefined();
    expect(del.data!.deleteSavedView.id).toBe(viewId);

    const listed = await gql(u.accessToken,
      `query($st:String!,$si:String!){ savedViews(scopeType:$st, scopeId:$si){ id } }`, { st: 'SPACE', si: p.Id });
    expect(listed.data!.savedViews.map((v: any) => v.id)).not.toContain(viewId);
  });
});
