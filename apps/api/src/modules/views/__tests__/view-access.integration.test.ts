import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { request } from '../../../__tests__/setup/testServer.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool } from '../../../shared/lib/db.js';

interface GqlResult { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] }
async function gql(token: string, query: string, variables: Record<string, unknown>): Promise<GqlResult> {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as GqlResult;
}

const emptyConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] });

describe('Views access control', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('a non-member cannot create a view on another workspace\'s space', async () => {
    const owner = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken);
    const p = await createTestProject(ws.Id, owner.accessToken);
    const outsider = await createTestUser();

    const res = await gql(
      outsider.accessToken,
      `mutation($i: CreateSavedViewInput!){ createSavedView(input: $i){ id } }`,
      { i: { scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'x', isShared: false, isDefault: false, config: emptyConfig } },
    );

    expect(res.errors, JSON.stringify(res)).toBeDefined();
    expect(res.errors!.length).toBeGreaterThan(0);
    expect(['FORBIDDEN', 'NOT_FOUND', 'UNAUTHENTICATED']).toContain(res.errors![0]?.extensions?.code);
    expect(res.data?.createSavedView ?? null).toBeNull();
  });

  it('owner sees both own-private and shared views at a node', async () => {
    const owner = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken);
    const p = await createTestProject(ws.Id, owner.accessToken);

    const mkView = (name: string, isShared: boolean) =>
      gql(owner.accessToken,
        `mutation($i: CreateSavedViewInput!){ createSavedView(input: $i){ id } }`,
        { i: { scopeType: 'SPACE', scopeId: p.Id, type: 'list', name, isShared, isDefault: false, config: emptyConfig } });

    const privResult = await mkView('private', false);
    expect(privResult.errors, JSON.stringify(privResult)).toBeUndefined();
    const sharedResult = await mkView('shared', true);
    expect(sharedResult.errors, JSON.stringify(sharedResult)).toBeUndefined();

    const own = await gql(
      owner.accessToken,
      `query($st: String!, $sid: String){ savedViews(scopeType: $st, scopeId: $sid){ name } }`,
      { st: 'SPACE', sid: p.Id },
    );
    expect(own.errors, JSON.stringify(own)).toBeUndefined();
    expect(own.data!.savedViews.map((v: any) => v.name).sort()).toEqual(['private', 'shared']);
  });

  it('a second workspace member sees shared view but NOT owner\'s private view', async () => {
    // This test exercises the IsShared=1 OR OwnerId=@UserId rule in usp_View_List
    // across two distinct users who both have access to the workspace/space.
    const owner = await createTestUser();
    const ws = await createTestWorkspace(owner.accessToken);
    const p = await createTestProject(ws.Id, owner.accessToken);
    const member = await createTestUser();

    // Owner invites member into the workspace.
    const invite = await request(`/workspaces/${ws.Id}/members/by-email`, {
      method: 'POST',
      token:  owner.accessToken,
      json:   { email: member.user.Email, role: 'MEMBER' },
    });
    expect(invite.status, `invite status: ${await invite.clone().text()}`).toBe(201);

    // Owner creates a private view and a shared view.
    const privResult = await gql(
      owner.accessToken,
      `mutation($i: CreateSavedViewInput!){ createSavedView(input: $i){ id } }`,
      { i: { scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'owner-private', isShared: false, isDefault: false, config: emptyConfig } },
    );
    expect(privResult.errors, JSON.stringify(privResult)).toBeUndefined();

    const sharedResult = await gql(
      owner.accessToken,
      `mutation($i: CreateSavedViewInput!){ createSavedView(input: $i){ id } }`,
      { i: { scopeType: 'SPACE', scopeId: p.Id, type: 'list', name: 'team-shared', isShared: true, isDefault: false, config: emptyConfig } },
    );
    expect(sharedResult.errors, JSON.stringify(sharedResult)).toBeUndefined();

    // Member lists views at the same scope node.
    const memberList = await gql(
      member.accessToken,
      `query($st: String!, $sid: String){ savedViews(scopeType: $st, scopeId: $sid){ name } }`,
      { st: 'SPACE', sid: p.Id },
    );
    expect(memberList.errors, JSON.stringify(memberList)).toBeUndefined();
    const names = memberList.data!.savedViews.map((v: any) => v.name);
    expect(names).toContain('team-shared');
    expect(names).not.toContain('owner-private');
  });
});
