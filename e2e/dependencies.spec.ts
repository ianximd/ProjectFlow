/**
 * E2E: task Dependencies (Phase 5a) — the drawer's "Waiting on" list and the
 * DEPENDENCY_BLOCKED close gate.
 *
 * One authed user seeds (over REST) a workspace → project → two tasks where
 * task A waits on task B, then links that edge through the REST dependency
 * endpoint (keeps the spec fast/robust — the picker's search UX is exercised by
 * unit/integration coverage, not here). The browser then:
 *   1. opens task A in the board drawer,
 *   2. confirms the "Waiting on" section lists task B,
 *   3. changes A's status to a DONE status via the drawer's status <select>,
 *   4. asserts the BlockerDialog (role="alertdialog") appears and names B.
 *
 * B is left in its default "To Do" status, so it is an OPEN blocker and the
 * /transition route answers A's close attempt with 409 DEPENDENCY_BLOCKED
 * (details.blockers = [B]); the drawer pops the alertdialog and rolls the
 * select back.
 *
 * Why seed/link over REST (not the UI picker):
 *   The board auto-scopes to the user's single project (resolveActiveId
 *   defaults to first workspace+project), so navigating to /board surfaces A
 *   and B as cards without any selection-cookie juggling. Seeding the edge over
 *   the API makes the "Waiting on already shows B" precondition deterministic.
 *
 * All post-action assertions use auto-retrying `expect`, so React hydration and
 * the server-action round-trip have time to settle without fixed sleeps. See
 * e2e/live-board.spec.ts and e2e/README.md for the setup/hydration idioms.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (see e2e/README.md).
 */

import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Log a user in through the UI and wait until they leave /login. */
async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

test('dependencies: drawer shows "Waiting on" and a DONE transition is blocked', async ({
  browser,
}) => {
  const suffix   = uniqSuffix();
  const password = 'E2EPass123!';
  const email    = `dep-${suffix}@projectflow.test`;
  const name     = `Dep User ${suffix}`;
  // Distinctive, single-occurrence titles so getByText can't false-match.
  const titleA = `Dep blocked ${suffix}`;
  const titleB = `Dep blocker ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── 1. Register + login (API) ───────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(login.status(), 'login').toBe(200);
  const { data: { token } } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  // ── 2. Workspace → project (Space) ──────────────────────────────────────────
  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `Dep WS ${suffix}`, slug: `dep-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId, 'workspaceId').toBeTruthy();

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers,
    data: { workspaceId, name: `Dep Project ${suffix}`, key: `DP${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = project.Id ?? project.id;
  expect(projectId, 'projectId').toBeTruthy();

  // A List under the Space. Tasks are created INTO this list (not project-only)
  // so the drawer's `GET /tasks/:id/dependencies` — gated by object-level VIEW
  // on the task's List — resolves. (Board-created tasks are project-scoped with
  // a NULL ListId, for which every task object-level GET route currently 404s;
  // that is a pre-existing, app-wide authz gap, not a Phase-5a regression — see
  // the batch report.) A list-scoped task still bridges ProjectId to the List's
  // Space, so it renders on the project board.
  const list = (await (await api.post(`${API_BASE}/lists`, {
    headers, data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
  })).json()).data;
  const listId: string = list.id ?? list.Id;
  expect(listId, 'listId').toBeTruthy();

  // ── 3. Two tasks: A (the blocked one) and B (its open blocker) ──────────────
  const taskRes = async (title: string) => {
    const r = await api.post(`${API_BASE}/tasks`, { headers, data: { workspaceId, listId, title } });
    expect(r.status(), `create ${title}`).toBe(201);
    const t = (await r.json()).data;
    return String(t.Id ?? t.id);
  };
  const taskAId = await taskRes(titleA);
  const taskBId = await taskRes(titleB);

  // ── 4. Link the edge over REST: A waits_on B ────────────────────────────────
  const link = await api.post(`${API_BASE}/tasks/${taskAId}/dependencies`, {
    headers, data: { dependsOnId: taskBId, relation: 'waiting_on' },
  });
  expect(link.status(), 'link A waits_on B').toBe(201);

  // Sanity: the REST list reflects the edge before we touch the UI.
  const listA = (await (await api.get(`${API_BASE}/tasks/${taskAId}/dependencies`, { headers })).json()).data;
  expect(
    (listA.waitingOn as { taskId: string }[]).some((x) => x.taskId.toUpperCase() === taskBId.toUpperCase()),
    'REST: A waitingOn contains B',
  ).toBe(true);

  // ── 5. Open A in the board drawer ───────────────────────────────────────────
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await uiLogin(page, email, password);
  await page.goto('/board');

  await expect(page.getByRole('region', { name: /kanban board/i })).toBeVisible({ timeout: 20_000 });
  // Both cards live in the default "To Do" column. Click A to open its drawer.
  const cardA = page.getByText(titleA, { exact: false });
  await expect(cardA).toBeVisible({ timeout: 20_000 });
  await cardA.click();

  // The drawer mounts a dialog. Its title is A's title (editable input) — wait
  // for the Dependencies section heading to confirm the drawer is fully open.
  await expect(page.getByText('Waiting on', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 6. "Waiting on" lists B ─────────────────────────────────────────────────
  // The DependenciesSection renders B as a row showing its title. Assert B's
  // title is visible within the drawer (it is NOT a board card title — those use
  // titleA/titleB; B's card is also on the board, so scope to the dialog).
  const drawer = page.getByRole('dialog').filter({ hasText: 'Waiting on' });
  await expect(drawer.getByText(titleB, { exact: false })).toBeVisible({ timeout: 20_000 });

  // ── 7. Change A's status to a DONE status → BlockerDialog appears naming B ───
  // The status <select> (aria-label "Status") triggers the transition; B is an
  // open blocker, so the API returns 409 DEPENDENCY_BLOCKED and the drawer pops
  // the alertdialog.
  await drawer.getByRole('combobox', { name: /status/i }).selectOption('Done');

  const blockerDialog = page.getByRole('alertdialog');
  await expect(blockerDialog).toBeVisible({ timeout: 20_000 });
  await expect(blockerDialog).toContainText(/open blockers/i);
  // The blocker list names B (title is the load-bearing, stable identifier).
  await expect(blockerDialog.getByText(titleB, { exact: false })).toBeVisible({ timeout: 20_000 });

  // ── 8. Cleanup ──────────────────────────────────────────────────────────────
  await ctx.close();
  const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
  expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
  await api.dispose();
});
