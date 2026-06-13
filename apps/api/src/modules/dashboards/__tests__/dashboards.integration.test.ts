/**
 * Phase 9a — Dashboards integration coverage.
 *
 * Exercises the dashboard service + SPs + REST routes against the REAL SQL
 * Server stack (local Docker ProjectFlow_Test DB).
 *
 * Tests:
 *   1. task_list card resolves live rows from the seeded space/list/task.
 *   2. calculation card counts tasks in scope (shape==='scalar', value>=1).
 *   3. Object-level scoping: a non-member stranger gets 403/404, never rows.
 *   4. reorder-cards persists layout/position + set-default enforces one-per-scope.
 *
 * truncateAll wipes Dashboards/DashboardCards between tests — they were added to
 * TRUNCATION_ORDER (child→parent: DashboardCards → Dashboards) before Workspaces/
 * Users, which they FK, so leftover rows can't FK-547 the suite's beforeEach.
 *
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import {
  createTestUser,
  createTestWorkspace,
  createTestProject,
} from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;

/**
 * Seed a workspace → space → list → task graph.
 * Returns owner handle, token, workspace, space, list id, and task id/title.
 */
async function seedScope() {
  seq += 1;
  const owner = await createTestUser({ email: `dash-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);

  // createTestProject creates a SPACE (Project in ProjectFlow's hierarchy)
  const space = await createTestProject(ws.Id, token, {
    name: 'Dash Space',
    key: `DS${(Date.now() + seq) % 100000}`,
  });

  // Create a List under the space (mirrors the goals integration test idiom)
  const listRes = await json<{ data: any }>(
    await request('/lists', {
      method: 'POST',
      token,
      json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default List', position: 0 },
    }),
    201,
  );
  const list = listRes.data;
  const listId = String(list.id ?? list.Id);
  expect(listId).toBeDefined();

  // Create a task IN the list so it's under the space's scopePath. The SPACE-scope
  // view compiler filters by hierarchy path; a task with no list is not in scope.
  const taskRes = await json<{ data: any }>(
    await request('/tasks', {
      method: 'POST',
      token,
      json: { workspaceId: ws.Id, listId, title: 'Live Task', type: 'TASK' },
    }),
    201,
  );
  const task = taskRes.data;
  expect(task.id ?? task.Id).toBeDefined();

  return { owner, token, ws, space, listId, task };
}

type SeedCtx = Awaited<ReturnType<typeof seedScope>>;

/** Create a space-scoped dashboard and return its id. */
async function createDashboard(ctx: SeedCtx, name = 'Test Dashboard'): Promise<string> {
  const res = await json<{ data: any }>(
    await request('/dashboards', {
      method: 'POST',
      token: ctx.token,
      json: { scopeType: 'space', scopeId: ctx.space.Id, name },
    }),
    201,
  );
  const id = String(res.data.id ?? res.data.Id);
  expect(id).toBeDefined();
  return id;
}

/** Add a card to a dashboard, return the card object. */
async function addCard(
  dashboardId: string,
  token: string,
  body: { type: string; config: Record<string, unknown>; layout: Record<string, number>; title?: string; position?: number },
): Promise<any> {
  const res = await json<{ data: any }>(
    await request(`/dashboards/${dashboardId}/cards`, {
      method: 'POST',
      token,
      json: body,
    }),
    201,
  );
  expect(res.data.id ?? res.data.Id).toBeDefined();
  return res.data;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Phase 9a — dashboards (integration)', () => {
  it('task_list card resolves live rows from the seeded task', async () => {
    const ctx = await seedScope();
    const dashboardId = await createDashboard(ctx);

    const card = await addCard(dashboardId, ctx.token, {
      type: 'task_list',
      config: { filter: { conjunction: 'AND', rules: [] }, pageSize: 25 },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    });
    const cardId = String(card.id ?? card.Id);

    const res = await request(`/dashboards/cards/${cardId}/data`, { token: ctx.token });
    expect(res.status).toBe(200);

    const body = await json<{ data: any }>(res);
    const d = body.data;

    expect(d.shape).toBe('rows');
    expect(d.total).toBeGreaterThanOrEqual(1);

    // The seeded task's title must appear in the rows (PascalCase or camelCase).
    const tasks: any[] = d.data ?? [];
    const found = tasks.some(
      (t: any) => (t.Title ?? t.title) === 'Live Task',
    );
    expect(found).toBe(true);
  });

  it('calculation card counts tasks in scope (scalar, value>=1)', async () => {
    const ctx = await seedScope();
    const dashboardId = await createDashboard(ctx);

    const card = await addCard(dashboardId, ctx.token, {
      type: 'calculation',
      config: { aggregate: { op: 'count' } },
      layout: { x: 0, y: 0, w: 4, h: 3 },
    });
    const cardId = String(card.id ?? card.Id);

    const res = await request(`/dashboards/cards/${cardId}/data`, { token: ctx.token });
    expect(res.status).toBe(200);

    const body = await json<{ data: any }>(res);
    const d = body.data;

    expect(d.shape).toBe('scalar');
    expect(d.data.value).toBeGreaterThanOrEqual(1);
  });

  it('a non-member stranger gets 403/404 when requesting card data', async () => {
    // Owner creates dashboard + card
    const ctx = await seedScope();
    const dashboardId = await createDashboard(ctx);
    const card = await addCard(dashboardId, ctx.token, {
      type: 'task_list',
      config: { filter: { conjunction: 'AND', rules: [] }, pageSize: 25 },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    });
    const cardId = String(card.id ?? card.Id);

    // Stranger: fresh user, owns their own workspace but has NO VIEW on owner's space
    seq += 1;
    const stranger = await createTestUser({ email: `dash-stranger-${Date.now()}-${seq}@projectflow.test` });
    // Give them their own workspace so they have workspace-owner permissions — but
    // only in their workspace, not the victim's.
    await createTestWorkspace(stranger.accessToken);

    const strangerRes = await request(`/dashboards/cards/${cardId}/data`, {
      token: stranger.accessToken,
    });
    expect([403, 404]).toContain(strangerRes.status);
  });

  it('reorder-cards persists layout/position and set-default enforces one-per-scope', async () => {
    const ctx = await seedScope();
    const dash1Id = await createDashboard(ctx, 'Dashboard One');

    // Add one card to dash1
    const card = await addCard(dash1Id, ctx.token, {
      type: 'calculation',
      config: { aggregate: { op: 'count' } },
      layout: { x: 0, y: 0, w: 4, h: 3 },
      position: 1,
    });
    const cardId = String(card.id ?? card.Id);

    // Reorder: update layout + position
    const reorderRes = await request(`/dashboards/${dash1Id}/reorder-cards`, {
      method: 'PUT',
      token: ctx.token,
      json: {
        cards: [
          { id: cardId, layout: { x: 4, y: 2, w: 6, h: 5 }, position: 10 },
        ],
      },
    });
    expect(reorderRes.status).toBe(200);

    const reorderBody = await json<{ data: any[] }>(reorderRes);
    const updated = reorderBody.data.find((c: any) => (c.id ?? c.Id) === cardId);
    expect(updated).toBeDefined();
    // Layout should reflect the new values
    const layout = updated.layout ?? JSON.parse(updated.Layout ?? '{}');
    expect(layout.x).toBe(4);
    expect(layout.y).toBe(2);
    expect(layout.w).toBe(6);
    expect(layout.h).toBe(5);
    // Position should reflect the new value
    const position = updated.position ?? updated.Position;
    expect(position).toBe(10);

    // Create a second dashboard in the SAME scope
    const dash2Id = await createDashboard(ctx, 'Dashboard Two');

    // Set dash1 as default first
    const setDefault1Res = await request(`/dashboards/${dash1Id}/set-default`, {
      method: 'POST',
      token: ctx.token,
    });
    expect(setDefault1Res.status).toBe(200);

    // Now set dash2 as default — should clear dash1's isDefault
    const setDefault2Res = await request(`/dashboards/${dash2Id}/set-default`, {
      method: 'POST',
      token: ctx.token,
    });
    expect(setDefault2Res.status).toBe(200);

    // List all dashboards in the same scope — exactly ONE must have isDefault===true, and it's dash2
    const listRes = await request(
      `/dashboards?scopeType=space&scopeId=${ctx.space.Id}`,
      { token: ctx.token },
    );
    expect(listRes.status).toBe(200);

    const listBody = await json<{ data: any[] }>(listRes);
    const dashboards: any[] = listBody.data;

    const defaults = dashboards.filter((d: any) => d.isDefault === true || d.IsDefault === true);
    expect(defaults).toHaveLength(1);

    const defaultDash = defaults[0];
    const defaultId = String(defaultDash.id ?? defaultDash.Id);
    expect(defaultId).toBe(dash2Id);
  });
});
