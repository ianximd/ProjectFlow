/**
 * E2E: Apps / Feature Toggles (Phase 10a) — the App Center toggle grid + the
 * frontend feature gate. Headline BUILD_PLAN acceptance (§4.5): disabling the
 * Time Tracking app hides the timer/work-log surface everywhere beneath that
 * scope; re-enabling restores it.
 *
 * One authed owner seeds (over REST) a workspace → project (Space) → list → ONE
 * task, then drives the browser:
 *   1. opens the task in the board drawer and asserts the time-tracking section
 *      ("Log work" button) is visible (time_tracking defaults ON),
 *   2. opens the workspace App Center (workspace settings) and flips the
 *      `time_tracking` switch OFF (aria-checked false),
 *   3. re-opens the task → the time-tracking section is GONE (the workspace-level
 *      override is inherited down to the task's List scope and the drawer hides
 *      the section),
 *   4. flips the switch back ON → the section reappears.
 *
 * Modeled on e2e/time-tracking.spec.ts (same register/login + workspace→project→
 * list→task seeding envelopes, the same `/board` → click-card → dialog drawer-open
 * idiom, and auto-retrying `expect`). The toggle is driven through the App Center
 * UI (data-app="time_tracking" row, role="switch") so the grid, the server
 * actions, the inheritance resolver, and the TaskDrawer gate are all exercised.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (ProjectFlow_Test) — see
 * e2e/README.md. Run by the controller (booting the dev servers needs the safe
 * DB env); do not run ad hoc against any other target.
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

/** Open the seeded task's board drawer (retry the open-click to absorb hydration). */
async function openTaskDrawer(page: Page, title: string) {
  await page.goto('/board');
  await expect(page.getByRole('region', { name: /kanban board/i })).toBeVisible({ timeout: 20_000 });
  const drawer = page.getByRole('dialog').filter({ hasText: title });
  await expect(async () => {
    const card = page.getByText(title, { exact: false }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();
    await expect(drawer).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  return drawer;
}

/** Flip the time_tracking switch in the workspace App Center to a target state. */
async function setTimeTrackingSwitch(page: Page, workspaceId: string, target: 'true' | 'false') {
  await page.goto(`/workspaces/${workspaceId}/settings`);
  const row = page.locator('[data-app="time_tracking"]');
  // The row only renders after the App Center's client fetch resolves, so its
  // presence means the component has hydrated and the switch is interactive.
  await expect(row).toBeVisible({ timeout: 20_000 });
  // The translated label must render (guards against a missing AppCenter i18n
  // namespace — a raw key path "...time_tracking.label" would not match).
  await expect(row).toContainText(/time tracking/i, { timeout: 10_000 });
  const sw = row.getByRole('switch');
  if ((await sw.getAttribute('aria-checked')) !== target) await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', target, { timeout: 10_000 });
}

test.describe('Phase 10a — app toggles', () => {
  test('disabling Time Tracking for the workspace hides the timer surface beneath it; enabling restores', async ({
    browser,
  }) => {
    const suffix   = uniqSuffix();
    const password = 'E2EPass123!';
    const email    = `apps-${suffix}@projectflow.test`;
    const name     = `Apps User ${suffix}`;
    const title    = `App toggle task ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register + login (API) ─────────────────────────────────────────────
    expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
    const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(login.status(), 'login').toBe(200);
    const { data: { token } } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 2. Workspace → project (Space) → list → task ──────────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, {
      headers, data: { name: `Apps WS ${suffix}`, slug: `apps-ws-${suffix}` },
    })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers,
      data: { workspaceId, name: `Apps Project ${suffix}`, key: `AP${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
    })).json()).data;
    const projectId: string = project.Id ?? project.id;
    expect(projectId, 'projectId').toBeTruthy();

    const list = (await (await api.post(`${API_BASE}/lists`, {
      headers, data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
    })).json()).data;
    const listId: string = list.id ?? list.Id;
    expect(listId, 'listId').toBeTruthy();

    const taskRes = await api.post(`${API_BASE}/tasks`, { headers, data: { workspaceId, listId, title } });
    expect(taskRes.status(), 'create task').toBe(201);

    // ── 3. Browser: baseline — the time-tracking section is visible ────────────
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, email, password);

    let drawer = await openTaskDrawer(page, title);
    await expect(drawer.getByRole('button', { name: /log work/i })).toBeVisible({ timeout: 20_000 });

    // ── 4. App Center: turn Time Tracking OFF for the workspace ────────────────
    await setTimeTrackingSwitch(page, workspaceId, 'false');

    // ── 5. Re-open the task → the time-tracking section is feature-absent ──────
    drawer = await openTaskDrawer(page, title);
    // The drawer starts with the section optimistically shown, then the gate
    // resolves the (inherited) OFF state and removes it — toHaveCount(0) retries.
    await expect(drawer.getByRole('button', { name: /log work/i })).toHaveCount(0, { timeout: 15_000 });

    // ── 6. Turn it back ON → the section reappears ─────────────────────────────
    await setTimeTrackingSwitch(page, workspaceId, 'true');
    drawer = await openTaskDrawer(page, title);
    await expect(drawer.getByRole('button', { name: /log work/i })).toBeVisible({ timeout: 20_000 });

    // ── 7. Cleanup ────────────────────────────────────────────────────────────
    await ctx.close();
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
