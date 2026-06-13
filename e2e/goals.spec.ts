/**
 * E2E: Goals & Targets (Phase 8e).
 *
 * Proves the headline acceptance end-to-end:
 *   "A task-linked Goal target updates progress automatically as tasks complete."
 *
 * One authed user seeds (over REST) a workspace → project (Space) → list → two
 * tasks, then creates a goal and a `task`-kind target whose taskFilter lists both
 * task ids. With nothing done, the target total is unset → progress 0. The two
 * tasks are then driven to Done via the REST transition endpoint, which fires the
 * after-commit goalService.recomputeForTask hook (fire-and-forget) — recomputing
 * the task-target's completed/total. The spec asserts (polling, then in the UI):
 *   1. (REST) GET /goals/:id progress climbs to 1 (100%) once both tasks are Done.
 *   2. (UI)  /goals renders the goal's progress bar at 100%.
 *
 * The recompute is fire-and-forget inside the API, so the spec POLLS the goal
 * endpoint until progress === 1 before checking the UI. See e2e/recurring.spec.ts
 * for the seed-over-REST + uiLogin + polling idioms.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (see e2e/README.md).
 */

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Log a user in through the UI and wait until they leave /login (app shell mounts). */
async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

/** Poll GET /goals/:id until data.progress reaches `target` (recompute is fire-and-forget). */
async function waitForGoalProgress(
  api: APIRequestContext,
  headers: Record<string, string>,
  goalId: string,
  target: number,
  timeoutMs = 20_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  for (;;) {
    const res = await api.get(`${API_BASE}/goals/${goalId}`, { headers });
    if (res.status() === 200) last = (await res.json()).data?.progress ?? -1;
    if (Math.abs(last - target) < 1e-6) return last;
    if (Date.now() > deadline) {
      throw new Error(`goal ${goalId} progress did not reach ${target}, saw ${last} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

test('goals: a task-linked target reaches 100% as its tasks complete (REST + UI)', async ({ browser }) => {
  const suffix   = uniqSuffix();
  const password = 'E2EPass123!';
  const email    = `goal-${suffix}@projectflow.test`;
  const name     = `Goal User ${suffix}`;
  const goalName = `Ship everything ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── 1. Register + login (API) ───────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(login.status(), 'login').toBe(200);
  const { data: { token } } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  // ── 2. Workspace → project (Space) → list ───────────────────────────────────
  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `Goal WS ${suffix}`, slug: `goal-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId, 'workspaceId').toBeTruthy();

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers, data: { workspaceId, name: `Goal Project ${suffix}`, key: `GP${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = project.Id ?? project.id;
  expect(projectId, 'projectId').toBeTruthy();

  const list = (await (await api.post(`${API_BASE}/lists`, {
    headers, data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
  })).json()).data;
  const listId: string = list.id ?? list.Id;
  expect(listId, 'listId').toBeTruthy();

  // ── 3. Two tasks (the rollup denominator) ───────────────────────────────────
  async function makeTask(title: string): Promise<string> {
    const res = await api.post(`${API_BASE}/tasks`, { headers, data: { workspaceId, listId, title } });
    expect(res.status(), `create task ${title}`).toBe(201);
    const body = (await res.json()).data;
    return String(body.Id ?? body.id);
  }
  const t1 = await makeTask(`Goal task A ${suffix}`);
  const t2 = await makeTask(`Goal task B ${suffix}`);

  // ── 4. A goal + a task-kind target counting both tasks ──────────────────────
  const goal = (await (await api.post(`${API_BASE}/goals`, {
    headers, data: { workspaceId, name: goalName },
  })).json()).data;
  const goalId: string = goal.id ?? goal.Id;
  expect(goalId, 'goalId').toBeTruthy();

  const targetRes = await api.post(`${API_BASE}/goals/${goalId}/targets`, {
    headers, data: { kind: 'task', name: 'Close tasks', taskFilter: JSON.stringify({ taskIds: [t1, t2] }) },
  });
  expect(targetRes.status(), 'create task-target').toBe(201);

  // ── 5. Complete both tasks → the after-commit recompute hook fires ──────────
  for (const id of [t1, t2]) {
    const tr = await api.patch(`${API_BASE}/tasks/${id}/transition`, { headers, data: { status: 'Done' } });
    expect(tr.status(), `transition ${id} to Done`).toBe(200);
  }

  // ── 6. (REST) goal progress climbs to 100% ──────────────────────────────────
  const progress = await waitForGoalProgress(api, headers, goalId, 1);
  expect(progress, 'goal progress reaches 1.0').toBeCloseTo(1);

  // ── 7. (UI) /goals renders the goal at 100% ─────────────────────────────────
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await uiLogin(page, email, password);
  await page.goto('/goals');

  // The goal card carries the goal name and a progressbar at 100% (the view renders
  // both a {pct}% label and role=progressbar / aria-valuenow). Auto-retry for
  // hydration + the SSR per-goal fetch.
  await expect(page.getByText(goalName, { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    const hundreds = page.getByText('100%', { exact: false });
    expect(await hundreds.count()).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 20_000 });

  // ── 8. Cleanup ──────────────────────────────────────────────────────────────
  await ctx.close();
  const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
  expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
  await api.dispose();
});
