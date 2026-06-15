/**
 * Phase 9d — Gantt resolver + baseline + live-drag integration coverage.
 * Exercises the Gantt GraphQL resolver, baseline freeze, and the date PATCH
 * realtime publish against the REAL SQL stack.
 * DB SAFETY: must target local Docker ProjectFlow_Test (see e2e/README).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { request } from '../../../__tests__/setup/testServer.js';
import { createTestUser, createTestWorkspace, createTestProject, createTestTask } from '../../../__tests__/fixtures/factories.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { pubsub } from '../../../graphql/pubsub.js';
import { taskEventKey } from '../../../graphql/task-events.js';

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

// Seeds a SPACE-scoped gantt SavedView over two dated, dependent tasks (B waits on A).
async function seedGantt() {
  const owner = await createTestUser();
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token);
  const a = await createTestTask(space.Id, ws.Id, token, { title: 'A' });
  const b = await createTestTask(space.Id, ws.Id, token, { title: 'B' });
  await setListPath(a.Id, `/${space.Id}/`);
  await setListPath(b.Id, `/${space.Id}/`);

  // Dates: A 06-01→06-03, B 06-03→06-08 (StartDate DATE, DueDate DATETIME2).
  const setDates = (id: string, s: string, d: string) =>
    request(`/roadmap/tasks/${id}/dates`, { method: 'PATCH', token, json: { startDate: s, dueDate: d } });
  await setDates(a.Id, '2026-06-01', '2026-06-03T00:00:00.000Z');
  await setDates(b.Id, '2026-06-03', '2026-06-08T00:00:00.000Z');
  // B waits on A.
  await request('/roadmap/dependencies', { method: 'POST', token, json: { taskId: b.Id, dependsOn: a.Id } });

  const create = await gql(token,
    `mutation($i: CreateSavedViewInput!){ createSavedView(input:$i){ id type } }`,
    { i: { scopeType: 'SPACE', scopeId: space.Id, type: 'gantt', name: 'GV', isShared: true, isDefault: false, config: emptyConfig } });
  expect(create.errors, JSON.stringify(create)).toBeUndefined();
  return { token, owner, ws, space, a, b, viewId: create.data!.createSavedView.id };
}

describe('gantt resolver', () => {
  beforeEach(async () => { await truncateAll(); });
  afterAll(async () => { await closePool(); });

  it('returns the in-scope tasks, the dependency edge, and the critical path', async () => {
    const { token, a, b, viewId } = await seedGantt();
    const res = await gql(token,
      `query($id:String!){ viewGanttData(viewId:$id){ tasks{ id startDate dueDate } edges{ taskId dependsOn } criticalPathIds baselines{ id } } }`,
      { id: viewId });
    expect(res.errors, JSON.stringify(res)).toBeUndefined();
    const g = res.data!.viewGanttData;
    expect(g.tasks.map((t: any) => t.id).sort()).toEqual([a.Id, b.Id].sort());
    expect(g.edges).toContainEqual({ taskId: b.Id, dependsOn: a.Id });
    // A(2d) -> B(5d) is the only chain: critical path = [A, B].
    expect(g.criticalPathIds).toEqual([a.Id, b.Id]);
    expect(g.baselines).toEqual([]);
  });

  it('captureBaseline freezes the current dates and List returns them', async () => {
    const { token, a, viewId } = await seedGantt();
    const cap = await gql(token,
      `mutation($id:String!,$n:String!){ captureBaseline(viewId:$id,name:$n){ id name } }`,
      { id: viewId, n: 'v1' });
    expect(cap.errors, JSON.stringify(cap)).toBeUndefined();
    expect(cap.data!.captureBaseline.name).toBe('v1');
    // Move A; the baseline still reflects the FROZEN (pre-move) date.
    await request(`/roadmap/tasks/${a.Id}/dates`, { method: 'PATCH', token, json: { startDate: '2026-06-05', dueDate: '2026-06-07T00:00:00.000Z' } });
    const res = await gql(token,
      `query($id:String!){ viewGanttData(viewId:$id){ baselines{ id name tasks{ taskId startDate } } } }`,
      { id: viewId });
    expect(res.errors, JSON.stringify(res)).toBeUndefined();
    const frozenA = res.data!.viewGanttData.baselines[0].tasks.find((x: any) => x.taskId === a.Id);
    expect(frozenA.startDate).toContain('2026-06-01'); // frozen, NOT 06-05
  });

  it('a date PATCH (Gantt drag) emits a task:event updated on the project topic', async () => {
    const { token, a, space } = await seedGantt();
    const events: any[] = [];
    const iter = pubsub.subscribe('task:event', taskEventKey.project(space.Id));
    const pump = (async () => { for await (const ev of iter) { events.push(ev); break; } })();
    // Give the subscription a tick to attach before publishing.
    await new Promise((r) => setTimeout(r, 50));
    await request(`/roadmap/tasks/${a.Id}/dates`, { method: 'PATCH', token, json: { startDate: '2026-06-04', dueDate: '2026-06-06T00:00:00.000Z' } });
    await Promise.race([pump, new Promise((r) => setTimeout(r, 1500))]);
    expect(events.some((e) => e.kind === 'updated' && e.taskId === a.Id)).toBe(true);
  });
});
