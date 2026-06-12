/**
 * E2E: Timesheets page (Phase 8b follow-up) — the /timesheets route that wires
 * the TimesheetGrid + TimesheetReview components to a real page.
 *
 * One authed user (the workspace creator → workspace-owner, which holds
 * timesheet.approve) seeds over REST a workspace → project (Space) → list → task
 * → ONE closed billable work-log inside the 2026-06-01..2026-06-07 week, then
 * drives the browser:
 *   1. navigates to /timesheets?period=2026-06-01 (deterministic week),
 *   2. asserts the grid aggregates the logged hour (row "Build", total "1h 0m")
 *      and the Mon→Sun period label renders ("Jun 1, 2026"),
 *   3. clicks Submit → the status badge flips to "Submitted",
 *   4. as an approver, the reviewer panel is shown → clicks Approve → the review
 *      status flips to "Approved".
 *
 * Modeled on e2e/time-tracking.spec.ts (single workspace auto-scopes /board and,
 * here, /timesheets — resolveActiveId defaults to the only workspace, so no
 * selection-cookie juggling). All post-action assertions use auto-retrying
 * `expect` so React hydration + the server-action refresh round-trips settle
 * without fixed sleeps.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (ProjectFlow_Test) — see
 * e2e/README.md. Booted by the controller with the safe DB env; do not run ad hoc.
 */

import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const PERIOD_START = '2026-06-01'; // a Monday → week 2026-06-01..2026-06-07

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

test.describe('Phase 8b — timesheets page', () => {
  test('view the weekly aggregate, submit, then approve', async ({ browser }) => {
    const suffix   = uniqSuffix();
    const password = 'E2EPass123!';
    const email    = `tspage-${suffix}@projectflow.test`;
    const name     = `TS Page User ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register + login (API) ─────────────────────────────────────────────
    expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
    const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(login.status(), 'login').toBe(200);
    const { data: { token } } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 2. Workspace → project (Space) → list → task ──────────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, {
      headers, data: { name: `TS WS ${suffix}`, slug: `ts-ws-${suffix}` },
    })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers,
      data: { workspaceId, name: `TS Project ${suffix}`, key: `TS${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
    })).json()).data;
    const projectId: string = project.Id ?? project.id;
    expect(projectId, 'projectId').toBeTruthy();

    const list = (await (await api.post(`${API_BASE}/lists`, {
      headers, data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
    })).json()).data;
    const listId: string = list.id ?? list.Id;
    expect(listId, 'listId').toBeTruthy();

    const taskRes = await api.post(`${API_BASE}/tasks`, { headers, data: { workspaceId, listId, title: 'Build' } });
    expect(taskRes.status(), 'create task').toBe(201);
    const taskBody = (await taskRes.json()).data;
    const taskId: string = String(taskBody.Id ?? taskBody.id);
    expect(taskId, 'taskId').toBeTruthy();

    // ── 3. One closed 1h billable work-log inside the week ────────────────────
    const wl = await api.post(`${API_BASE}/worklogs`, {
      headers,
      data: { taskId, timeSpentSeconds: 3600, startedAt: '2026-06-02T09:00:00.000Z', billable: true, source: 'manual' },
    });
    expect(wl.status(), 'log work').toBe(201);

    // ── 4. Open the timesheets page for the seeded week ───────────────────────
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, email, password);
    await page.goto(`/timesheets?period=${PERIOD_START}`);

    // Grid aggregates the logged hour; period label renders the Mon→Sun bounds.
    const grid = page.getByTestId('timesheet-grid');
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('timesheet-row').filter({ hasText: 'Build' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('timesheet-total')).toHaveText('1h 0m');
    await expect(page.getByTestId('timesheet-period')).toContainText('Jun 1, 2026');
    await expect(page.getByTestId('timesheet-status')).toHaveText(/draft/i);

    // ── 5. Submit → status flips to Submitted ─────────────────────────────────
    await page.getByTestId('timesheet-submit').click();
    await expect(page.getByTestId('timesheet-status')).toHaveText(/submitted/i, { timeout: 20_000 });

    // ── 6. As an approver, Approve → review status flips to Approved ──────────
    const review = page.getByTestId('timesheet-review');
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review.getByTestId('review-status')).toHaveText(/submitted/i);
    await review.getByTestId('review-approve').click();
    await expect(review.getByTestId('review-status')).toHaveText(/approved/i, { timeout: 20_000 });

    // ── 7. Cleanup ────────────────────────────────────────────────────────────
    await ctx.close();
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
