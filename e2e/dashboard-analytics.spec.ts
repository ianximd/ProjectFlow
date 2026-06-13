/**
 * E2E: Dashboard analytics cards (Phase 9b).
 *
 * One authed user seeds (over REST) a workspace → project (Space) → list →
 * a sprint + 5 story-pointed tasks. Then it drives the browser to /dashboard
 * (which seeds the default WORKSPACE "Overview" dashboard via
 * ensureWorkspaceDashboards), reads that dashboard's id over REST, and creates
 * three 9b analytics cards via the cards API WITH reportParams set:
 *   - burndown  (config.reportParams.sprintId)
 *   - velocity  (config.reportParams.projectId)
 *   - portfolio (config.reportParams.scopeType='list', scopeIds=[listId])
 * Cards are created via the API (not the UI add-menu) so their reportParams are
 * populated — the API card.service cross-tenant guard returns null/"No data" for
 * a report card with empty params, so a UI-added card with no config would be
 * blank. After reloading /dashboard, each card must render REAL seeded data:
 * the burndown + velocity cards render a Recharts <svg>, and the portfolio card
 * renders a per-scope on-track/behind badge (proving the rollup SP returned the
 * seeded list).
 *
 * Modeled on e2e/dashboards.spec.ts (REST seed envelopes + uiLogin + the
 * SSR→hydration auto-retry). DB SAFETY: run ONLY with the local Docker test DB
 * env (ProjectFlow_Test). Run by the controller (booting dev servers needs the
 * safe DB env).
 */

import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

test.describe('Phase 9b — analytics cards', () => {
  test('burndown + velocity + portfolio cards render real seeded data on a dashboard', async ({ browser }) => {
    const suffix   = uniqSuffix();
    const password = 'E2EPass123!';
    const email    = `analytics-${suffix}@projectflow.test`;
    const name     = `Analytics User ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register + login ───────────────────────────────────────────────────
    expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
    const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(login.status(), 'login').toBe(200);
    const { data: { token } } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 2. Workspace → project → list ─────────────────────────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, {
      headers, data: { name: `An WS ${suffix}`, slug: `an-ws-${suffix}` },
    })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers, data: { workspaceId, name: `An Project ${suffix}`, key: `AN${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
    })).json()).data;
    const projectId: string = project.Id ?? project.id;
    expect(projectId, 'projectId').toBeTruthy();

    const list = (await (await api.post(`${API_BASE}/lists`, {
      headers, data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
    })).json()).data;
    const listId: string = list.id ?? list.Id;
    expect(listId, 'listId').toBeTruthy();

    // ── 3. Sprint + 5 story-pointed tasks (3 worth 4pts, 2 worth 1pt) ─────────
    const sprint = (await (await api.post(`${API_BASE}/sprints`, {
      headers, data: { projectId, name: 'S1', startDate: '2026-05-01', endDate: '2026-05-14' },
    })).json()).data;
    const sprintId: string = sprint.id ?? sprint.Id;
    expect(sprintId, 'sprintId').toBeTruthy();

    for (let i = 0; i < 5; i += 1) {
      const res = await api.post(`${API_BASE}/tasks`, {
        headers, data: { workspaceId, listId, title: `T${i}-${suffix}`, sprintId, storyPoints: i < 3 ? 4 : 1 },
      });
      expect(res.status(), `create task ${i}`).toBe(201);
    }

    // ── 4. Open /dashboard → seeds the default workspace dashboard ────────────
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, email, password);
    await page.goto('/dashboard');
    await expect(page.locator('[data-add-type="task_list"]')).toBeVisible({ timeout: 20_000 });

    // ── 5. Read the seeded default dashboard's id over REST ───────────────────
    const dashList = (await (await api.get(`${API_BASE}/dashboards?scopeType=workspace&workspaceId=${workspaceId}`, { headers })).json()).data;
    expect(Array.isArray(dashList) && dashList.length > 0, 'default dashboard seeded').toBeTruthy();
    const dashboardId: string = dashList[0].id ?? dashList[0].Id;
    expect(dashboardId, 'dashboardId').toBeTruthy();

    // ── 6. Create the three analytics cards WITH reportParams (API) ───────────
    const mkCard = (type: string, reportParams: Record<string, unknown>, x: number) =>
      api.post(`${API_BASE}/dashboards/${dashboardId}/cards`, {
        headers,
        data: { type, title: type, config: { reportParams }, layout: { x, y: 0, w: 2, h: 2 } },
      });
    expect((await mkCard('burndown',  { sprintId }, 0)).status(), 'add burndown').toBe(201);
    expect((await mkCard('velocity',  { projectId }, 2)).status(), 'add velocity').toBe(201);
    expect((await mkCard('portfolio', { scopeType: 'list', scopeIds: [listId] }, 4)).status(), 'add portfolio').toBe(201);

    // ── 7. Reload → the three cards render real seeded data ───────────────────
    await page.goto('/dashboard');
    await expect(page.locator('[data-card-type="burndown"]')).toBeVisible({ timeout: 20_000 });
    // burndown + velocity render a Recharts <svg> (real series, not the "No data" guard).
    await expect(page.locator('[data-card-type="burndown"] svg').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-card-type="velocity"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-card-type="velocity"] svg').first()).toBeVisible({ timeout: 20_000 });
    // portfolio renders an on-track/behind badge per scope (proves the rollup SP ran over the seeded list).
    await expect(page.locator('[data-card-type="portfolio"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-card-type="portfolio"]').getByText(/on track|behind/i).first()).toBeVisible({ timeout: 20_000 });

    // ── 8. Cleanup ────────────────────────────────────────────────────────────
    await ctx.close();
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
