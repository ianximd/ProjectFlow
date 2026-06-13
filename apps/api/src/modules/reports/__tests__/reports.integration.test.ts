/**
 * Phase 9b — GraphQL reports mirror integration coverage.
 *
 * Exercises the NEW GraphQL surface for the reports module (registerReportsGraphql)
 * end-to-end against the live DB, proving each report query computes correctly and
 * agrees with the existing REST endpoint. The reports module was REST-only before
 * this slice; this is its first GraphQL test.
 *
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 * The seed mirrors the sprint-folder integration tests: tasks are inserted via
 * direct SQL (PascalCase columns) and the first three are transitioned to a
 * DONE-category status through the GraphQL transitionTask mutation, which sets
 * Tasks.ResolvedAt (the column every report SP keys "completed" on).
 */
import sql from 'mssql';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { getPool, closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

interface GqlResult { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] }
async function gql(query: string, variables: Record<string, unknown>, token?: string): Promise<GqlResult> {
  const res = await request('/graphql', { method: 'POST', token, json: { query, variables } });
  return (await res.json()) as GqlResult;
}

/**
 * Seed a sprint with 5 tasks (story points [4,4,4,1,1]) and transition the first
 * three to DONE. Returns the handles the assertions need.
 *   committed = 14   (all 5 with points)
 *   completed = 12   (the three resolved 4+4+4)
 */
async function seedSprint() {
  const owner = await createTestUser({ email: `reports-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ownerId = owner.user.Id;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Reports Space', key: `RP${Date.now() % 100000}` });

  // A real Lists row (with a Path) so getScopeNode('LIST') resolves the workspace
  // for the list-scoped portfolio query.
  const listRes = await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201);
  const listId: string = listRes.data.id ?? listRes.data.Id;

  const pool = await getPool();

  // Sprint: explicit window 2026-05-01 .. 2026-05-14 (StartDate must be non-null
  // for velocity to include the sprint).
  const sprintId: string = (await pool.request()
    .input('ProjectId', sql.UniqueIdentifier, space.Id)
    .input('Name', sql.NVarChar(255), 'Sprint Alpha')
    .input('Start', sql.DateTime2, new Date('2026-05-01T00:00:00Z'))
    .input('End', sql.DateTime2, new Date('2026-05-14T00:00:00Z'))
    .query(`
      DECLARE @id UNIQUEIDENTIFIER = NEWID();
      INSERT INTO dbo.Sprints (Id, ProjectId, Name, Status, StartDate, EndDate)
      VALUES (@id, @ProjectId, @Name, 'ACTIVE', @Start, @End);
      SELECT @id AS Id;`)).recordset[0].Id;

  const points = [4, 4, 4, 1, 1];
  const taskIds: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const id: string = (await pool.request()
      .input('ProjectId', sql.UniqueIdentifier, space.Id)
      .input('WorkspaceId', sql.UniqueIdentifier, ws.Id)
      .input('IssueKey', sql.NVarChar(30), `RPT-${i + 1}`)
      .input('ReporterId', sql.UniqueIdentifier, ownerId)
      .input('SprintId', sql.UniqueIdentifier, sprintId)
      .input('ListId', sql.UniqueIdentifier, listId)
      .input('Points', sql.Float, points[i])
      .query(`
        DECLARE @id UNIQUEIDENTIFIER = NEWID();
        INSERT INTO dbo.Tasks (Id, ProjectId, WorkspaceId, IssueKey, Title, Status, ReporterId, SprintId, ListId, StoryPoints)
        VALUES (@id, @ProjectId, @WorkspaceId, @IssueKey, 'T', 'To Do', @ReporterId, @SprintId, @ListId, @Points);
        SELECT @id AS Id;`)).recordset[0].Id;
    taskIds.push(id);
  }

  // Transition the first three to DONE via the GraphQL mutation. The project has
  // no workflow attached (default KANBAN), so usp_Task_Transition stamps
  // ResolvedAt whenever the target status is in (Done|Resolved|Closed|Completed).
  for (const id of taskIds.slice(0, 3)) {
    const r = await gql(
      'mutation($id:String!,$s:String!){transitionTask(id:$id,status:$s){id status}}',
      { id, s: 'Done' }, token,
    );
    expect(r.errors, JSON.stringify(r)).toBeUndefined();
    expect(r.data?.transitionTask?.status).toBe('Done');
  }

  return { token, ownerId, wsId: ws.Id, projectId: space.Id, listId, sprintId, taskIds };
}

describe('Phase 9b — GraphQL reports mirror', () => {
  it('burndown matches the REST endpoint (totalPoints + points.length)', async () => {
    const s = await seedSprint();

    const rest = (await json<{ data: any }>(
      await request(`/reports/burndown?sprintId=${s.sprintId}`, { token: s.token }), 200,
    )).data;

    const g = await gql(
      'query($id:String!){burndown(sprintId:$id){totalPoints points{date remainingPoints idealPoints}}}',
      { id: s.sprintId }, s.token,
    );
    expect(g.errors, JSON.stringify(g)).toBeUndefined();
    const bd = g.data?.burndown;
    expect(bd).toBeTruthy();
    expect(bd.totalPoints).toBe(14);
    expect(bd.totalPoints).toBe(rest.totalPoints);
    expect(bd.points.length).toBe(rest.points.length);
  });

  it('velocity reports committed=14 / completed=12 for the sprint (spec §5.5)', async () => {
    const s = await seedSprint();

    const g = await gql(
      'query($p:String!){velocity(projectId:$p,numSprints:5){sprintId sprintName committedPoints completedPoints}}',
      { p: s.projectId }, s.token,
    );
    expect(g.errors, JSON.stringify(g)).toBeUndefined();
    const entry = (g.data?.velocity ?? []).find((v: any) => v.sprintId === s.sprintId);
    expect(entry, JSON.stringify(g.data?.velocity)).toBeTruthy();
    expect(entry.committedPoints).toBe(14);
    expect(entry.completedPoints).toBe(12);
  });

  it('burnup reports scope=14 / completed=12 and every point completed<=scope', async () => {
    const s = await seedSprint();

    const g = await gql(
      'query($id:String!){burnup(sprintId:$id){totalScopePoints completedPoints points{date completedPoints scopePoints}}}',
      { id: s.sprintId }, s.token,
    );
    expect(g.errors, JSON.stringify(g)).toBeUndefined();
    const bu = g.data?.burnup;
    expect(bu).toBeTruthy();
    expect(bu.totalScopePoints).toBe(14);
    expect(bu.completedPoints).toBe(12);
    expect(bu.points.length).toBeGreaterThan(0);
    for (const p of bu.points) {
      expect(p.completedPoints).toBeLessThanOrEqual(p.scopePoints);
    }
  });

  it('cumulativeFlow / leadCycleTime / portfolio resolve over the seeded scope', async () => {
    const s = await seedSprint();

    // cumulativeFlow over the space scope (scopeType passed verbatim to the SP,
    // which matches the lowercase 'space' band; the authz resolver uppercases for
    // getScopeNode internally).
    const cf = await gql(
      'query($st:String!,$si:String!){cumulativeFlow(scopeType:$st,scopeId:$si,weeks:8){date status issueCount}}',
      { st: 'space', si: s.projectId }, s.token,
    );
    expect(cf.errors, JSON.stringify(cf)).toBeUndefined();
    expect(Array.isArray(cf.data?.cumulativeFlow)).toBe(true);

    // leadCycleTime over the space scope — all 5 seeded tasks fall inside the
    // 12-week window and share ProjectId = space.
    const lct = await gql(
      'query($st:String!,$si:String!){leadCycleTime(scopeType:$st,scopeId:$si,weeks:12){scopeType scopeId tasks{taskId leadTimeSeconds}}}',
      { st: 'space', si: s.projectId }, s.token,
    );
    expect(lct.errors, JSON.stringify(lct)).toBeUndefined();
    expect(lct.data?.leadCycleTime?.scopeType).toBe('space');
    expect(lct.data?.leadCycleTime?.tasks?.length).toBe(5);

    // portfolio over a list scope (portfolio SP supports 'folder'|'list' only).
    const pf = await gql(
      'query($st:String!,$ids:[String!]!){portfolio(scopeType:$st,scopeIds:$ids){scopeId totalIssues completedIssues progressPct onTrack}}',
      { st: 'list', ids: [s.listId] }, s.token,
    );
    expect(pf.errors, JSON.stringify(pf)).toBeUndefined();
    expect(Array.isArray(pf.data?.portfolio)).toBe(true);
    const entry = (pf.data?.portfolio ?? []).find((p: any) => p.scopeId === s.listId);
    expect(entry, JSON.stringify(pf.data?.portfolio)).toBeTruthy();
    expect(entry.totalIssues).toBe(5);
    expect(entry.completedIssues).toBe(3);
  });
});
