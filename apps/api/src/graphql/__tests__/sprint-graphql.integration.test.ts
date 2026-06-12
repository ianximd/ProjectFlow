/**
 * Phase 8c — GraphQL sprint-folder mirror. DB SAFETY: local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from '../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../__tests__/fixtures/factories.js';
import { getPool, closePool } from '../../shared/lib/db.js';
import { request } from '../../__tests__/setup/testServer.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function gql(query: string, variables: any, token: string) {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as any;
}

describe('GraphQL sprint-folder mirror', () => {
  it('createSprintInFolder returns id/listId/folderId/status and points resolves', async () => {
    const owner = await createTestUser({ email: `gql-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const space = await createTestProject(ws.Id, token, { name: 'Gql Space', key: `GQ${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      INSERT INTO dbo.SprintSettings (FolderId, DurationDays, AutoStart, AutoComplete, AutoRollForward)
      VALUES (@id, 14, 0, 0, 0);
      SELECT @id AS Id;`)).recordset[0].Id;

    const r = await gql(
      `mutation ($f: String!, $n: String!) { createSprintInFolder(folderId: $f, name: $n) { id listId folderId status points } }`,
      { f: folderId, n: 'S1' }, token,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data.createSprintInFolder.id).toBeTruthy();
    expect(r.data.createSprintInFolder.status).toBe('PLANNED');
    expect(r.data.createSprintInFolder.listId).toBeTruthy();
    expect(r.data.createSprintInFolder.folderId).toBe(folderId);
    expect(r.data.createSprintInFolder.points).toBe(0);
  });

  it('rejects createSprintInFolder for a non-member of the folder workspace (C1 cross-tenant guard)', async () => {
    const owner = await createTestUser({ email: `gqlo-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'GqlO Space', key: `GO${Date.now() % 100000}` });
    const pool = await getPool();
    const folderId = (await pool.request().query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Folders (Id, WorkspaceId, SpaceId, Name, Position, Path, IsSprintFolder)
      VALUES (@id, '${ws.Id}', '${space.Id}', 'Sprints', 0, '/${space.Id}/f/', 1);
      SELECT @id AS Id;`)).recordset[0].Id;

    // A user with no role in the folder's workspace must NOT be able to write.
    const outsider = await createTestUser({ email: `gqlx-${Date.now()}@projectflow.test` });
    const r = await gql(
      `mutation ($f: String!, $n: String!) { createSprintInFolder(folderId: $f, name: $n) { id } }`,
      { f: folderId, n: 'X' }, outsider.accessToken,
    );
    expect(r.errors).toBeTruthy();
    expect(r.data?.createSprintInFolder ?? null).toBeNull();
  });
});
