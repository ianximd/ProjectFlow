/**
 * E2E: Live notification delivery via SSE subscription
 *
 * This spec proves the `notificationAdded` SSE subscription (backed by
 * GraphQL `useSubscription`) delivers in real-time. When user B posts a
 * comment that @-mentions user A, A's NotificationBell badge should appear
 * **without a page reload** within the assertion timeout.
 *
 * Important operational notes
 * ───────────────────────────
 * 1. SSE subscriptions use Apollo Client's `WebSocketLink` (or `GraphQL-WS`
 *    transport) which ultimately relies on server-side pub/sub. In a
 *    **multi-process** deployment (e.g. multiple API pods) you **must** have
 *    Redis configured as the pubsub backend; the in-process EventEmitter
 *    pubsub only delivers events within the same Node process.
 *
 * 2. This test makes real HTTP calls and drives a real browser. It is
 *    intentionally **not** run against the production database. The
 *    `webServer` in playwright.config.ts starts the API, so you must run
 *    this only when `apps/api/.env` points at a local/test database with
 *    Redis available. The live run is **deferred** — see the project
 *    MEMORY.md note on DB_TARGET.
 *
 * 3. All waits use element visibility with an explicit `timeout`, never
 *    `page.waitForTimeout` / fixed sleeps.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

test('SSE: mention comment triggers live notification badge for mentioned user', async ({
  browser,
}) => {
  const suffix   = uniqSuffix();
  const password = 'E2EPass123!';

  const emailA = `rt-a-${suffix}@projectflow.test`;
  const nameA  = `RT User A ${suffix}`;
  const emailB = `rt-b-${suffix}@projectflow.test`;
  const nameB  = `RT User B ${suffix}`;

  // ── 1. Register users A and B via API ──────────────────────────────────────
  const apiCtx = await playwrightRequest.newContext();

  const regA = await apiCtx.post(`${API_BASE}/auth/register`, {
    data: { email: emailA, name: nameA, password },
  });
  expect(regA.status(), 'register user A').toBe(201);

  const regB = await apiCtx.post(`${API_BASE}/auth/register`, {
    data: { email: emailB, name: nameB, password },
  });
  expect(regB.status(), 'register user B').toBe(201);

  // ── 2. Login A via API → obtain A's token + userId ────────────────────────
  const loginARes = await apiCtx.post(`${API_BASE}/auth/login`, {
    data: { email: emailA, password },
  });
  expect(loginARes.status(), 'login user A').toBe(200);
  const { data: { token: tokenA } } = await loginARes.json();

  const meARes = await apiCtx.get(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  expect(meARes.status(), '/auth/me for user A').toBe(200);
  const { data: meA } = await meARes.json();
  // The API returns PascalCase; defensively accept both casings.
  const aUserId: string = meA.Id ?? meA.id;
  expect(aUserId, 'A userId resolved').toBeTruthy();

  // ── 3. Login B via API → obtain B's token ────────────────────────────────
  const loginBRes = await apiCtx.post(`${API_BASE}/auth/login`, {
    data: { email: emailB, password },
  });
  expect(loginBRes.status(), 'login user B').toBe(200);
  const { data: { token: tokenB } } = await loginBRes.json();

  const bHeaders = { Authorization: `Bearer ${tokenB}` };

  // ── 4. As B: create workspace ─────────────────────────────────────────────
  const wsSlug = `rt-ws-${suffix}`;
  const wsRes  = await apiCtx.post(`${API_BASE}/workspaces`, {
    headers: bHeaders,
    data: { name: `RT Workspace ${suffix}`, slug: wsSlug },
  });
  expect(wsRes.status(), 'create workspace').toBe(201);
  const { data: workspace } = await wsRes.json();
  const workspaceId: string = workspace.Id ?? workspace.id;
  expect(workspaceId, 'workspaceId resolved').toBeTruthy();

  // ── 5. As B: add user A as a workspace member ────────────────────────────
  // POST /workspaces/:id/members  { userId, role }
  const addMemberRes = await apiCtx.post(`${API_BASE}/workspaces/${workspaceId}/members`, {
    headers: bHeaders,
    data: { userId: aUserId, role: 'MEMBER' },
  });
  expect(addMemberRes.status(), 'add A as workspace member').toBe(201);

  // ── 6. As B: create a project (Space) ────────────────────────────────────
  // POST /projects  { workspaceId, name, key, type? }
  const projKey = `RT${suffix.slice(-4).toUpperCase()}`;
  const projRes = await apiCtx.post(`${API_BASE}/projects`, {
    headers: bHeaders,
    data: {
      workspaceId,
      name: `RT Project ${suffix}`,
      key:  projKey,
      type: 'KANBAN',
    },
  });
  expect(projRes.status(), 'create project').toBe(201);
  const { data: project } = await projRes.json();
  const projectId: string = project.Id ?? project.id;
  expect(projectId, 'projectId resolved').toBeTruthy();

  // ── 7. As B: create a task in the project ────────────────────────────────
  // POST /tasks  { workspaceId, projectId, title }
  // "At least one of projectId or listId is required" — projectId alone suffices.
  const taskRes = await apiCtx.post(`${API_BASE}/tasks`, {
    headers: bHeaders,
    data: {
      workspaceId,
      projectId,
      title: `RT mention task ${suffix}`,
    },
  });
  expect(taskRes.status(), 'create task').toBe(201);
  const { data: task } = await taskRes.json();
  const taskId: string = task.Id ?? task.id;
  expect(taskId, 'taskId resolved').toBeTruthy();

  // ── 8. Open a browser context for A and log in via the UI ────────────────
  const aCtx  = await browser.newContext();
  const aPage = await aCtx.newPage();

  await aPage.goto('/login');
  await aPage.locator('#email').fill(emailA);
  await aPage.locator('#password').fill(password);
  await aPage.getByRole('button', { name: /sign in/i }).click();

  // Wait until A has left the /login page — the app shell mounts here,
  // NotificationBell renders, and the SSE/WebSocket subscription connects.
  await aPage.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 15_000,
  });

  // Give the subscription transport a moment to handshake. We wait on the
  // bell element (even with 0 unread it should be in the DOM) rather than
  // sleeping. The bell wrapper is always rendered; only the badge span
  // (aria-label) is conditional on unread > 0.
  // We wait for any navigation (app shell) to fully paint before posting.
  await aPage.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
    // networkidle is best-effort; proceed if it times out
  });

  // ── 9. As B (API): post a comment mentioning A ────────────────────────────
  // Mention token format (slice 3.5a): @[DisplayName](userId)
  const commentBody = `Hey @[${nameA}](${aUserId}) please review this.`;
  const commentRes  = await apiCtx.post(`${API_BASE}/comments`, {
    headers: bHeaders,
    data: { taskId, body: commentBody },
  });
  expect(commentRes.status(), 'post comment mentioning A').toBe(201);

  // ── 10. Assert: A's unread-badge appears live (no reload) ─────────────────
  // NotificationBell renders:
  //   <span aria-label="{n} unread notifications" …>{n}</span>
  // only when unread > 0. The SSE `notificationAdded` event increments the
  // counter. We wait up to 15 s for the live push to arrive.
  await expect(aPage.getByLabel(/unread notifications/i)).toBeVisible({
    timeout: 15_000,
  });

  // ── 11. Cleanup ──────────────────────────────────────────────────────────
  // Close A's browser context first (subscription teardown).
  await aCtx.close();

  // Soft-delete the workspace (cascades to project/tasks/comments).
  // Best-effort: a 404 here just means it was already gone.
  const delRes = await apiCtx.delete(`${API_BASE}/workspaces/${workspaceId}`, {
    headers: bHeaders,
  });
  expect([204, 404], 'workspace cleanup').toContain(delRes.status());

  await apiCtx.dispose();
});
