/**
 * E2E: Live board task events via the `taskEvents` SSE subscription
 * (Phase 3.5 deferred-item cleanup, Task 8 — §1/§2 verification).
 *
 * Proves the project board's live wiring end-to-end. Context A views a
 * project board (`/board`, scoped to `ctx.activeProjectId`); Context B — a
 * second authed member of the SAME project — creates a task, then transitions
 * it to Done, then deletes it, all over the REST API. Context A must see each
 * change WITHOUT reloading, delivered through the project-keyed `taskEvents`
 * graphql-sse subscription (server publish in task.routes.ts → SSELink →
 * useLiveTasks → applyTaskEvent → the board re-buckets/removes the card).
 *
 * Why B mutates over the API (not a 2nd UI):
 *   The existing realtime-notifications.spec seeds + mutates over REST and only
 *   drives ONE browser (the receiver). The board's create/move/delete REST
 *   routes all `publishTaskEvent(...)`, so an API mutation exercises the exact
 *   same publish path a 2nd UI would, more deterministically (no 2nd-board
 *   hydration race). What's under test is A RECEIVING the live event.
 *
 * Why no cookie/selection juggling for A's board scope:
 *   A is a member of exactly ONE workspace containing exactly ONE project
 *   (both created by B). `resolveActiveId` (server/queries/select-context)
 *   defaults to the first workspace + first project when the selection cookie
 *   is absent, so A's `/board` auto-scopes to B's project. The board's
 *   `useLiveTasks` subscribes keyed by that `ctx.activeProjectId`.
 *
 * Operational notes
 * ─────────────────
 * 1. Requires REDIS for cross-context pub/sub (the in-process pubsub only
 *    delivers within a single Node process) AND a local/test database. Run
 *    ONLY with explicit local DB env (DB_SERVER=localhost … DB_NAME=
 *    ProjectFlow_Test, local REDIS_URL) so it never touches prod — see
 *    e2e/README.md and MEMORY.md DB_TARGET.
 * 2. All waits are on element visibility/count with explicit timeouts —
 *    `expect(...)` auto-retries, so the SSE event has time to arrive without
 *    fixed sleeps.
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

test('live board: a second member sees create → transition → delete without reload', async ({
  browser,
}) => {
  const suffix   = uniqSuffix();
  const password = 'E2EPass123!';
  // A distinctive, single-occurrence title so getByText can't false-match.
  const cardTitle = `Live card ${suffix}`;

  const emailA = `lb-a-${suffix}@projectflow.test`;
  const nameA  = `LB User A ${suffix}`;
  const emailB = `lb-b-${suffix}@projectflow.test`;
  const nameB  = `LB User B ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── 1. Register A + B ───────────────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email: emailA, name: nameA, password } })).status(), 'register A').toBe(201);
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email: emailB, name: nameB, password } })).status(), 'register B').toBe(201);

  // ── 2. Login A (API) → A's userId; Login B (API) → B's token ─────────────────
  const loginA = await api.post(`${API_BASE}/auth/login`, { data: { email: emailA, password } });
  expect(loginA.status(), 'login A').toBe(200);
  const { data: { token: tokenA } } = await loginA.json();
  const meA = await api.get(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const meABody = (await meA.json()).data;
  const aUserId: string = meABody.Id ?? meABody.id;
  expect(aUserId, 'A userId resolved').toBeTruthy();

  const loginB = await api.post(`${API_BASE}/auth/login`, { data: { email: emailB, password } });
  expect(loginB.status(), 'login B').toBe(200);
  const { data: { token: tokenB } } = await loginB.json();
  const bHeaders = { Authorization: `Bearer ${tokenB}` };

  // ── 3. B creates workspace → adds A as member → project (Space) ──────────────
  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers: bHeaders, data: { name: `LB Workspace ${suffix}`, slug: `lb-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId, 'workspaceId resolved').toBeTruthy();

  expect((await api.post(`${API_BASE}/workspaces/${workspaceId}/members`, {
    headers: bHeaders, data: { userId: aUserId, role: 'MEMBER' },
  })).status(), 'add A as member').toBe(201);

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers: bHeaders,
    data: { workspaceId, name: `LB Project ${suffix}`, key: `LB${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = project.Id ?? project.id;
  expect(projectId, 'projectId resolved').toBeTruthy();

  // ── 4. A opens the project board ─────────────────────────────────────────────
  // A's only workspace+project is the one B just made, so /board auto-scopes to
  // it (resolveActiveId defaults to first). The board mounts useLiveTasks and
  // the SSE subscription connects.
  const ctxA  = await browser.newContext();
  const pageA = await ctxA.newPage();
  await uiLogin(pageA, emailA, password);

  // Arm a wait for the `taskEvents` graphql-sse subscription BEFORE navigating.
  // graphql-sse (distinct-connections mode) opens the subscription with a POST
  // to /graphql whose body carries the operation; the server replies with a
  // `text/event-stream` response once it has subscribed the project topic. SSE
  // does NOT replay missed events, so B must mutate only AFTER this stream is
  // live — otherwise a `created` published into the gap is silently dropped.
  // Gating on the response (headers received) removes that race deterministically.
  const subscriptionLive = pageA.waitForResponse(
    (r) => {
      if (!r.url().includes('/api/v1/graphql') || r.request().method() !== 'POST') return false;
      const body = r.request().postData() ?? '';
      return body.includes('taskEvents') || body.includes('TaskEvents');
    },
    { timeout: 25_000 },
  );

  await pageA.goto('/board');

  // The Kanban board region renders (default workflow columns). The region
  // wrapper carries a stable aria-label; per-column card lists derive their
  // accessible name from the column header and aren't a reliable handle when
  // empty, so we don't gate on them here.
  await expect(pageA.getByRole('region', { name: /kanban board/i })).toBeVisible({ timeout: 20_000 });
  await expect(pageA.getByRole('heading', { name: /^to do$/i })).toBeVisible({ timeout: 20_000 });
  // The new card does not exist yet.
  await expect(pageA.getByText(cardTitle, { exact: false })).toHaveCount(0);

  // Block until A's taskEvents SSE stream is actually established server-side.
  await subscriptionLive;
  // Redis-backed pubsub: the SSE response headers can flush to the client BEFORE
  // the server's Redis SUBSCRIBE for the `prj:<id>` topic has round-tripped.
  // Redis pub/sub is fire-and-forget (no replay), so a `created` published into
  // that sub-second registration gap is dropped. This is NOT an event-arrival
  // wait (those use auto-retrying `expect`s below) — it's a one-time settle for
  // the subscriber-registration boundary, the minimum needed to make the very
  // first publish deterministic. EXPERIMENT-CONFIRMED necessary: without it the
  // create event races the SUBSCRIBE; with it all three phases deliver.
  await pageA.waitForTimeout(1500);

  // ── 5. B creates a task → A sees the card appear live (no reload) ────────────
  // New tasks default to status "To Do" (task.repository), so it lands in that
  // column. POST /tasks publishes a `created` taskEvent on the project topic.
  const taskRes = await api.post(`${API_BASE}/tasks`, {
    headers: bHeaders,
    data: { workspaceId, projectId, title: cardTitle },
  });
  expect(taskRes.status(), 'B create task').toBe(201);
  const task = (await taskRes.json()).data;
  const taskId: string = task.Id ?? task.id;
  expect(taskId, 'taskId resolved').toBeTruthy();

  await expect(pageA.getByText(cardTitle, { exact: false })).toBeVisible({ timeout: 20_000 });

  // ── 6. B transitions it to Done → A sees it re-bucketed under the Done column ─
  // PATCH /tasks/:id/transition publishes an `updated` taskEvent; the board
  // merges the new status and re-buckets the card. Scope the assertion to the
  // "Done" column wrapper (a role="listitem" containing the "Done" heading) so
  // we assert the card is genuinely in the Done column, not merely still on the
  // board. (The per-column card list's accessible name is unreliable when the
  // column is empty, so we anchor on the column's heading instead.)
  const transRes = await api.patch(`${API_BASE}/tasks/${taskId}/transition`, {
    headers: bHeaders, data: { status: 'Done' },
  });
  expect(transRes.status(), 'B transition task to Done').toBe(200);

  const doneColumn = pageA
    .getByRole('listitem')
    .filter({ has: pageA.getByRole('heading', { name: /^done$/i }) });
  await expect(doneColumn.getByText(cardTitle, { exact: false })).toBeVisible({ timeout: 20_000 });

  // ── 7. B deletes it → A sees the card disappear live (no reload) ─────────────
  const delRes = await api.delete(`${API_BASE}/tasks/${taskId}`, { headers: bHeaders });
  expect(delRes.status(), 'B delete task').toBe(200);

  await expect(pageA.getByText(cardTitle, { exact: false })).toHaveCount(0, { timeout: 20_000 });

  // ── 8. Cleanup ───────────────────────────────────────────────────────────────
  await ctxA.close();
  const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers: bHeaders });
  expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
  await api.dispose();
});
