/**
 * E2E: Recurring tasks (Phase 5c, Batch 3).
 *
 * Proves the Phase 5c on-complete acceptance end-to-end:
 *   "a recurring task regenerates its next occurrence when it is completed."
 *
 * One authed user seeds (over REST) a workspace → project (Space) → list → one
 * task with a due date, then PUTs a WEEKLY recurrence in mode `both` (covers
 * on_complete + schedule) via PUT /tasks/:id/recurrence. The task is then driven
 * to a DONE status through the REST transition endpoint, which fires the
 * on-complete spawn. The spec asserts (auto-retrying / polling):
 *   1. (REST) the project's task list grows from 1 task to 2 — the spawned
 *      occurrence shares the same title, and
 *   2. (UI)  the board renders TWO cards carrying that title.
 *
 * Why seed + transition over REST (not the drawer status select):
 *   The drawer status <select> is exercised by e2e/dependencies.spec.ts; the
 *   recurrence rule editor UI is covered by web unit tests. What's under test
 *   here is the SPAWN: a completed recurring task producing the next occurrence.
 *   The KANBAN project created via POST /projects has no attached workflow, so
 *   any transition is allowed and 'Done' counts as a DONE-group status (the
 *   on-complete trigger). Seeding + transitioning over the API makes the
 *   "second task now exists" precondition deterministic and keeps the spec fast.
 *
 * The on-complete spawn is fire-and-forget inside the API process, so the spec
 * POLLS the task-list endpoint until the second occurrence appears, then
 * confirms it in the UI with auto-retrying expects. See e2e/dependencies.spec.ts
 * / e2e/relationships.spec.ts / e2e/README.md for the setup + hydration idioms.
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

/** Poll GET /tasks?projectId until at least `count` tasks exist (or time out). */
async function waitForTaskCount(
  api: APIRequestContext,
  headers: Record<string, string>,
  projectId: string,
  count: number,
  timeoutMs = 20_000,
): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  let last: any[] = [];
  for (;;) {
    const res = await api.get(`${API_BASE}/tasks?projectId=${projectId}`, { headers });
    if (res.status() === 200) last = (await res.json()).data ?? [];
    if (last.length >= count) return last;
    if (Date.now() > deadline) {
      throw new Error(`expected >= ${count} tasks for project ${projectId}, saw ${last.length} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

test('recurring: completing a recurring task spawns the next occurrence (REST + board)', async ({ browser }) => {
  const suffix   = uniqSuffix();
  const password = 'E2EPass123!';
  const email    = `rec-${suffix}@projectflow.test`;
  const name     = `Rec User ${suffix}`;
  // Distinctive, single-occurrence title so getByText can't false-match — both
  // the source and the spawned occurrence share it (the clone copies the title).
  const title = `Recurring standup ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── 1. Register + login (API) ───────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(login.status(), 'login').toBe(200);
  const { data: { token } } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  // ── 2. Workspace → project (Space) → list ───────────────────────────────────
  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `Rec WS ${suffix}`, slug: `rec-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId, 'workspaceId').toBeTruthy();

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers, data: { workspaceId, name: `Rec Project ${suffix}`, key: `RC${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = project.Id ?? project.id;
  expect(projectId, 'projectId').toBeTruthy();

  // A List under the Space. The task is created INTO this list so its
  // object-level recurrence routes resolve and the spawned clone lands in the
  // same list (and bridges ProjectId so it renders on the board).
  const list = (await (await api.post(`${API_BASE}/lists`, {
    headers, data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
  })).json()).data;
  const listId: string = list.id ?? list.Id;
  expect(listId, 'listId').toBeTruthy();

  // ── 3. The recurring task (with a due date the next occurrence remaps from) ──
  const taskRes = await api.post(`${API_BASE}/tasks`, {
    headers, data: { workspaceId, listId, title, dueDate: '2026-01-12T09:00:00.000Z' },
  });
  expect(taskRes.status(), 'create task').toBe(201);
  const taskBody = (await taskRes.json()).data;
  const taskId: string = String(taskBody.Id ?? taskBody.id);
  expect(taskId, 'taskId').toBeTruthy();

  // ── 4. PUT a weekly recurrence (mode `both` → on_complete + schedule) ───────
  const recRes = await api.put(`${API_BASE}/tasks/${taskId}/recurrence`, {
    headers, data: { rule: { freq: 'weekly', interval: 1 }, regenerateMode: 'both' },
  });
  expect(recRes.status(), 'set recurrence').toBe(200);
  const rec = (await recRes.json()).data;
  expect(rec.active, 'recurrence active').toBe(true);

  // Sanity: exactly one task in the project before completion.
  const before = await waitForTaskCount(api, headers, projectId, 1);
  expect(before.length, 'one task before completion').toBe(1);

  // ── 5. Complete the task → on-complete spawn fires ──────────────────────────
  const transition = await api.patch(`${API_BASE}/tasks/${taskId}/transition`, {
    headers, data: { status: 'Done' },
  });
  expect(transition.status(), 'transition to Done').toBe(200);

  // ── 6. (REST) the project now has TWO tasks; the new one shares the title ────
  const after = await waitForTaskCount(api, headers, projectId, 2);
  expect(after.length, 'two tasks after completion').toBeGreaterThanOrEqual(2);
  const titled = after.filter((t: any) => (t.Title ?? t.title) === title);
  expect(titled.length, 'both occurrences carry the title').toBeGreaterThanOrEqual(2);

  // The recurrence advanced: LastSpawnedTaskId points at a NEW task (not the source).
  const recAfter = (await (await api.get(`${API_BASE}/tasks/${taskId}/recurrence`, { headers })).json()).data;
  expect(recAfter, 'recurrence still present').toBeTruthy();
  expect(String(recAfter.lastSpawnedTaskId ?? '').toUpperCase(), 'spawned a fresh occurrence')
    .not.toBe(taskId.toUpperCase());

  // ── 7. (UI) the board renders TWO cards with the title ──────────────────────
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await uiLogin(page, email, password);
  await page.goto('/board');

  await expect(page.getByRole('region', { name: /kanban board/i })).toBeVisible({ timeout: 20_000 });
  // Both the completed source and the spawned occurrence carry the same title.
  // Assert at least two cards render it (auto-retrying for hydration + fetch).
  const cards = page.getByText(title, { exact: false });
  await expect(async () => {
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 20_000 });

  // ── 8. Cleanup ──────────────────────────────────────────────────────────────
  await ctx.close();
  const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
  expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
  await api.dispose();
});
