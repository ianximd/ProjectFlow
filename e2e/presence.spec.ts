/**
 * E2E: Task-detail presence — viewer avatars + typing indicator (Phase 3.5c, Task 11)
 *
 * Proves the presence feature end-to-end: when two users open the SAME task's
 * detail drawer, each sees the other as a viewer ("N person/people viewing"),
 * and when one types in the comment composer the other sees a typing indicator.
 * Presence rides the `presenceUpdated` graphql-sse subscription + the
 * `presenceHeartbeat`/`presenceLeave` mutations (VIEW-gated on the task's List).
 *
 * Operational notes
 * ─────────────────
 * 1. Requires REDIS for cross-context pub/sub (the in-process pubsub only
 *    delivers within a single Node process) AND a local/test database.
 * 2. The live run is DEFERRED: the default Playwright `webServer` boots the API
 *    via `npm run dev`, which loads `apps/api/.env` (currently prod). Run this
 *    ONLY with explicit local DB env (DB_SERVER=localhost … DB_NAME=ProjectFlow_Test)
 *    so it never touches prod. See MEMORY.md DB_TARGET.
 * 3. All waits are on element visibility with explicit timeouts — never fixed sleeps.
 * 4. TODO(live-run): the drawer-open flow (board navigation + task-card click) and
 *    the comment-composer locator are the parts most likely to need selector
 *    tweaks when first run live — they are based on the current board-view /
 *    MentionInput structure (board opens TaskDrawer via an onOpenTask card click;
 *    the composer is a <textarea>). Adjust selectors here if the UI shifts.
 */

import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';

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

/**
 * Open the given task's detail drawer from the board.
 * The board (board-view.tsx) opens <TaskDrawer> when a task card is clicked
 * (onOpenTask → setSelectedTask) — there is no URL-hash handler — so we navigate
 * to /board and click the card bearing the task title.
 * TODO(live-run): if the active workspace/project isn't auto-selected so the task
 * card is visible, select it first (workspace/project picker) before the click.
 */
async function openTaskDrawer(page: Page, taskTitle: string) {
  await page.goto('/board');
  const card = page.getByText(taskTitle, { exact: false }).first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();
}

test('a second viewer avatar appears and typing toggles', async ({ browser }) => {
  const suffix   = uniqSuffix();
  const password = 'E2EPass123!';

  const emailA = `pr-a-${suffix}@projectflow.test`;
  const nameA  = `PR User A ${suffix}`;
  const emailB = `pr-b-${suffix}@projectflow.test`;
  const nameB  = `PR User B ${suffix}`;
  const taskTitle = `Presence task ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── 1. Register A + B ──────────────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email: emailA, name: nameA, password } })).status()).toBe(201);
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email: emailB, name: nameB, password } })).status()).toBe(201);

  // ── 2. Login A (API) → A's userId; Login B (API) → B's token ───────────────
  const loginA = await api.post(`${API_BASE}/auth/login`, { data: { email: emailA, password } });
  const { data: { token: tokenA } } = await loginA.json();
  const meA = await api.get(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const meABody = (await meA.json()).data;
  const aUserId: string = meABody.Id ?? meABody.id;
  expect(aUserId).toBeTruthy();

  const loginB = await api.post(`${API_BASE}/auth/login`, { data: { email: emailB, password } });
  const { data: { token: tokenB } } = await loginB.json();
  const bHeaders = { Authorization: `Bearer ${tokenB}` };

  // ── 3. B creates workspace → adds A as member → project → List → task ──────
  // The task lives in an explicit List so presence's VIEW authz (LIST/VIEW)
  // resolves for both users (a task with only a projectId has no List).
  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers: bHeaders, data: { name: `PR Workspace ${suffix}`, slug: `pr-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;

  expect((await api.post(`${API_BASE}/workspaces/${workspaceId}/members`, {
    headers: bHeaders, data: { userId: aUserId, role: 'MEMBER' },
  })).status()).toBe(201);

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers: bHeaders,
    data: { workspaceId, name: `PR Project ${suffix}`, key: `PR${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = project.Id ?? project.id;

  const list = (await (await api.post(`${API_BASE}/lists`, {
    headers: bHeaders,
    data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
  })).json()).data;
  const listId: string = list.id ?? list.Id;

  const task = (await (await api.post(`${API_BASE}/tasks`, {
    headers: bHeaders, data: { workspaceId, listId, title: taskTitle },
  })).json()).data;
  const taskId: string = task.Id ?? task.id;
  expect(taskId).toBeTruthy();

  // ── 4. Both users open the SAME task detail in separate browser contexts ───
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await uiLogin(a, emailA, password);
  await uiLogin(b, emailB, password);

  await openTaskDrawer(a, taskTitle);
  await openTaskDrawer(b, taskTitle);

  // ── 5. A sees B as a viewer (presence snapshot delivered live) ─────────────
  await expect(a.getByText(/person viewing|people viewing/i)).toBeVisible({ timeout: 15_000 });

  // ── 6. B types in the comment composer → A sees the typing indicator ───────
  // The new-comment composer is a <textarea> (MentionInput). TODO(live-run):
  // scope to the comment section if multiple textareas are present.
  await b.locator('textarea').first().fill('typing a message…');
  await expect(a.getByText(/typing/i)).toBeVisible({ timeout: 15_000 });

  // ── 7. Cleanup ─────────────────────────────────────────────────────────────
  await ctxA.close();
  await ctxB.close();
  const del = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers: bHeaders });
  expect([204, 404]).toContain(del.status());
  await api.dispose();
});
