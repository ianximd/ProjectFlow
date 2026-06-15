/**
 * E2E: Phase 9d — Gantt + Timeline views.
 *
 * Headline acceptance (BUILD_PLAN §7.5): a Gantt view shows dependency lines
 * between bars (from TaskDependencies), highlights the critical path (longest
 * dependency chain by duration), and overlays a captured baseline. A Gantt drag
 * (the v1 double-click "+1 day" affordance) updates the task's dates and reflects
 * LIVE in a List view open in a second tab (the date PATCH path now publishes a
 * `task:event updated`). A Timeline view groups tasks into date lanes and a bar
 * reschedules.
 *
 * All seeding is API-driven (robust vs UI selectors). Requires a local/test DB +
 * REDIS — run ONLY with explicit local DB env (DB_NAME=ProjectFlow_Test …) so it
 * never touches prod. See e2e/README.md.
 */

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const EMPTY_CONFIG = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] });

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function gql<T = any>(api: APIRequestContext, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await api.post(`${API_BASE}/graphql`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { query, variables },
  });
  const body = await res.json();
  expect(body.errors, JSON.stringify(body.errors)).toBeUndefined();
  return body.data as T;
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

interface Seed {
  email: string; password: string; token: string; api: APIRequestContext;
  projectId: string; ganttViewId: string; timelineViewId: string; listViewId: string;
  titleA: string; titleB: string;
}

/** Seed two dated, dependent tasks (B waits on A) under a Space + a gantt, a
 *  timeline, and a list SavedView over that Space. */
async function seed(): Promise<Seed> {
  const suffix = uniqSuffix();
  const password = 'E2EPass123!';
  const email = `gantt-${suffix}@projectflow.test`;
  const titleA = `Gantt A ${suffix}`;
  const titleB = `Gantt B ${suffix}`;
  const api = await playwrightRequest.newContext();

  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name: `Gantt ${suffix}`, password } })).status()).toBe(201);
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email, password } })).json();
  const h = { Authorization: `Bearer ${token}` };

  const ws = (await (await api.post(`${API_BASE}/workspaces`, { headers: h, data: { name: `GW ${suffix}`, slug: `gw-${suffix}` } })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers: h, data: { workspaceId, name: `GP ${suffix}`, key: `G${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = project.Id ?? project.id;
  const list = (await (await api.post(`${API_BASE}/lists`, {
    headers: h, data: { workspaceId, spaceId: projectId, folderId: null, name: 'L', position: 0 },
  })).json()).data;
  const listId: string = list.id ?? list.Id;

  const mk = async (title: string) => {
    const r = (await (await api.post(`${API_BASE}/tasks`, { headers: h, data: { workspaceId, projectId, title, listId } })).json()).data;
    return (r.Id ?? r.id) as string;
  };
  const aId = await mk(titleA);
  const bId = await mk(titleB);

  // Dates: A 06-01→06-03 (2d), B 06-05→06-10 (5d). Critical path = [A, B]. The
  // gap between A's due and B's start gives the dependency line horizontal extent
  // (an adjacent A.due==B.start would render a degenerate zero-width vertical line).
  const setDates = (id: string, s: string, d: string) =>
    api.patch(`${API_BASE}/roadmap/tasks/${id}/dates`, { headers: h, data: { startDate: s, dueDate: d } });
  expect((await setDates(aId, '2026-06-01', '2026-06-03T00:00:00.000Z')).status()).toBe(200);
  expect((await setDates(bId, '2026-06-05', '2026-06-10T00:00:00.000Z')).status()).toBe(200);
  // B waits on A.
  expect((await api.post(`${API_BASE}/roadmap/dependencies`, { headers: h, data: { taskId: bId, dependsOn: aId } })).status()).toBe(201);

  const mkView = async (type: string, name: string) => {
    const d = await gql<{ createSavedView: { id: string } }>(api, token,
      `mutation($i: CreateSavedViewInput!){ createSavedView(input:$i){ id } }`,
      { i: { scopeType: 'SPACE', scopeId: projectId, type, name, isShared: true, isDefault: false, config: EMPTY_CONFIG } });
    return d.createSavedView.id;
  };
  const ganttViewId = await mkView('gantt', 'GanttV');
  const timelineViewId = await mkView('timeline', 'TimelineV');
  const listViewId = await mkView('list', 'ListV');

  return { email, password, token, api, projectId, ganttViewId, timelineViewId, listViewId, titleA, titleB };
}

test.describe('Phase 9d — Gantt + Timeline', () => {
  test('Gantt: dependency line + critical path + baseline, drag reflects live in List', async ({ browser }) => {
    const s = await seed();
    const ctx = await browser.newContext();
    const gantt = await ctx.newPage();
    await uiLogin(gantt, s.email, s.password);

    // ── Open the Gantt view ───────────────────────────────────────────────────
    await gantt.goto(`/views/SPACE/${s.projectId}?viewId=${s.ganttViewId}`);
    await expect(gantt.getByTestId('view-body-gantt')).toBeVisible({ timeout: 20_000 });

    // Dependency line + critical-path highlight render.
    await expect(gantt.getByTestId('gantt-dep-line').first()).toBeVisible({ timeout: 15_000 });
    await expect(gantt.locator('[data-testid="gantt-bar"][data-critical="true"]').first()).toBeVisible();

    // Capture a baseline → the overlay bar appears.
    await gantt.getByTestId('gantt-capture-baseline').click();
    await expect(gantt.getByTestId('gantt-baseline-bar').first()).toBeVisible({ timeout: 15_000 });

    // ── Open List in a second tab and arm its live subscription ─────────────────
    const list = await ctx.newPage();
    const subLive = list.waitForResponse(
      (r) => r.url().includes('/api/v1/graphql') && r.request().method() === 'POST'
        && /taskEvents|TaskEvents/.test(r.request().postData() ?? ''),
      { timeout: 25_000 },
    );
    await list.goto(`/views/SPACE/${s.projectId}?viewId=${s.listViewId}`);
    await expect(list.getByTestId('view-body-list')).toBeVisible({ timeout: 20_000 });
    await expect(list.getByText(s.titleA, { exact: false })).toBeVisible({ timeout: 15_000 });
    await subLive;
    await list.waitForTimeout(1500); // settle the Redis SUBSCRIBE before publishing

    // ── Drag task A on the Gantt (+1 day) → date PATCH → live `updated` event ────
    // dispatchEvent bypasses the actionability hit-test: the absolutely-positioned
    // bar sits under its row wrapper, which Playwright sees as intercepting clicks.
    const barA = gantt.locator('[data-testid="gantt-row"]', { hasText: s.titleA }).getByTestId('gantt-bar');
    await barA.dispatchEvent('dblclick');

    // The List tab re-merges the live update: A's row stays present with a due-date
    // cell (the live `updated` carried the new dueDate; the row is never blanked).
    const rowA = list.locator('[data-testid="list-row"]', { hasText: s.titleA });
    await expect(rowA).toBeVisible({ timeout: 20_000 });
    await expect(rowA.getByTestId('task-due-date')).toBeVisible({ timeout: 15_000 });

    await ctx.close();
    await s.api.delete(`${API_BASE}/workspaces/${s.projectId}`, { headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {});
    await s.api.dispose();
  });

  test('Timeline: lanes group tasks and a bar reschedules', async ({ browser }) => {
    const s = await seed();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, s.email, s.password);

    await page.goto(`/views/SPACE/${s.projectId}?viewId=${s.timelineViewId}`);
    await expect(page.getByTestId('view-body-timeline')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('timeline-lane').first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('timeline-bar').first().dispatchEvent('dblclick');
    // Survives the reschedule + SSR refresh.
    await expect(page.getByTestId('view-body-timeline')).toBeVisible({ timeout: 15_000 });

    await ctx.close();
    await s.api.dispose();
  });
});
