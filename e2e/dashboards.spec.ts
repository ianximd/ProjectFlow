/**
 * E2E: Dashboards core (Phase 9a) — the config-driven dashboard grid.
 *
 * One authed user seeds (over REST) a workspace → project (Space) → list → ONE
 * task, then drives the browser:
 *   1. opens /dashboard (the page seeds a default WORKSPACE-scoped "Overview"
 *      dashboard via ensureWorkspaceDashboards on first visit),
 *   2. adds SIX card types via the toolbar add-buttons (data-add-type),
 *   3. asserts each card renders (data-card-type) and the data-backed ones show
 *      live data: the task_list card lists the seeded task; the calculation card
 *      shows a count >= 1 (the workspace-scoped cards run viewService.runConfig
 *      over EVERYTHING, so the seeded workspace task surfaces),
 *   4. opens the task_list card's config drawer, adds a per-card filter rule, saves,
 *   5. clicks "Export PDF" → the ?print=1 print-optimized layout renders (h1 title);
 *      window.print is stubbed so headless chromium doesn't block.
 *
 * Modeled on e2e/time-tracking.spec.ts (REST register/login + workspace→project→
 * list→task seeding envelopes; uiLogin; auto-retrying expects for the SSR→hydration
 * gap). Card-add is non-idempotent, so the add helper only clicks when the card is
 * not yet present (count-guarded toPass) to absorb hydration without double-adding.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (ProjectFlow_Test) — see
 * e2e/README.md. Run by the controller (booting the dev servers needs the safe DB env).
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

test.describe('Phase 9a — dashboards core', () => {
  test('builds a dashboard with >=6 card types + live data + per-card filter + PDF export', async ({ browser }) => {
    const suffix   = uniqSuffix();
    const password = 'E2EPass123!';
    const email    = `dash-${suffix}@projectflow.test`;
    const name     = `Dash User ${suffix}`;
    const title    = `Dashboard task ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register + login (API) ─────────────────────────────────────────────
    expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
    const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(login.status(), 'login').toBe(200);
    const { data: { token } } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 2. Workspace → project (Space) → list → one task ──────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, {
      headers, data: { name: `Dash WS ${suffix}`, slug: `dash-ws-${suffix}` },
    })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers,
      data: { workspaceId, name: `Dash Project ${suffix}`, key: `DB${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
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

    // ── 3. Open /dashboard (seeds the default workspace dashboard) ────────────
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    // Stub window.print BEFORE any navigation so the print layout's auto-print
    // doesn't block headless chromium. addInitScript persists across the App-Router
    // client-side navigation to ?print=1 (same document).
    await page.addInitScript(() => { (window as any).print = () => { (window as any).__printed = true; }; });
    await uiLogin(page, email, password);
    await page.goto('/dashboard');

    // The grid toolbar (add-menu) confirms the page + grid hydrated.
    await expect(page.locator('[data-add-type="task_list"]')).toBeVisible({ timeout: 20_000 });

    // ── 4. Add six card types (count-guarded so hydration retries don't dupe) ─
    const types = ['task_list', 'calculation', 'bar', 'line', 'pie', 'time_tracked'] as const;
    for (const type of types) {
      await expect(async () => {
        if (await page.locator(`[data-card-type="${type}"]`).count() === 0) {
          await page.locator(`[data-add-type="${type}"]`).click();
        }
        await expect(page.locator(`[data-card-type="${type}"]`)).toHaveCount(1, { timeout: 6_000 });
      }).toPass({ timeout: 40_000 });
    }
    // >=6 distinct card types now on the board.
    await expect(page.locator('[data-card-type]')).toHaveCount(types.length, { timeout: 10_000 });

    // ── 5. Live data: the task_list card lists the seeded task; calc shows >=1 ─
    const taskListCard = page.locator('[data-card-type="task_list"]');
    await expect(taskListCard.getByText(title, { exact: false })).toBeVisible({ timeout: 20_000 });

    const calcCard = page.locator('[data-card-type="calculation"]');
    // The big-number renderer shows the count (>=1 since the workspace has the task).
    await expect(calcCard.getByText(/^[1-9]\d*$/)).toBeVisible({ timeout: 20_000 });

    // ── 6. Per-card filter: open the task_list card config, add a rule, save ──
    await taskListCard.getByRole('button', { name: /configure/i }).click();
    await page.getByTestId('card-add-filter').click();
    await page.getByTestId('card-filter-rule').locator('input').fill('Done');
    await page.getByRole('button', { name: /^save$/i }).click();
    // The drawer closes on save (configuring → null).
    await expect(page.getByTestId('card-add-filter')).toBeHidden({ timeout: 10_000 });

    // ── 7. Export to PDF → the ?print=1 print layout renders ──────────────────
    await page.getByTestId('export-pdf').click();
    await expect(page).toHaveURL(/print=1/, { timeout: 15_000 });
    // The print layout renders an <h1> with the dashboard name ("Overview", the
    // seeded default). Target it by name to disambiguate from the app-shell header.
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 15_000 });

    // ── 8. Cleanup ────────────────────────────────────────────────────────────
    await ctx.close();
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
