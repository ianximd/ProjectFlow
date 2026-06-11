/**
 * E2E: Time Tracking (Phase 8a) — the task drawer's global timer + work-log list
 * and the estimate bar.
 *
 * One authed user seeds (over REST) a workspace → project (Space) → list → ONE
 * task, then drives the browser:
 *   1. opens the task in the board drawer,
 *   2. clicks "Log work" → "Start timer" (WorkLogSection.onStartTimerHere →
 *      startTimer action; dispatches 'worklog:timer-changed'),
 *   3. asserts the GLOBAL timer widget appears in the header
 *      (aria-label "Timer running") with live elapsed text (/^\d+:\d{2}/),
 *   4. clicks its "Stop" button → widget renders null (hidden) and the just-closed
 *      entry appears in the WorkLogSection list as [data-worklog-source="timer"],
 *   5. sets an estimate via TaskEstimateBar ("Set estimate" → input "1h" → "Save")
 *      and confirms the bar legend ("Logged …") renders.
 *
 * Modeled on e2e/dependencies.spec.ts (single task, board-drawer open, REST seed)
 * — the same register/login + workspace→project→list→task seeding envelopes and
 * the same `/board` → click-card → dialog drawer-open idiom. Tasks are created
 * INTO a List (not project-only) so the drawer's object-level task GETs resolve;
 * a list-scoped task still bridges ProjectId to the List's Space, so it renders as
 * a board card. The user is in exactly ONE workspace/project, so `/board`
 * auto-scopes (resolveActiveId defaults to first) — no selection-cookie juggling.
 *
 * All post-action assertions use auto-retrying `expect`, so React hydration + the
 * server-action round-trips settle without fixed sleeps. The first drawer-open
 * click is retried via `expect(async () => { … }).toPass()` to absorb the
 * SSR→hydration gap on the board card. See e2e/dependencies.spec.ts /
 * e2e/relationships.spec.ts / e2e/README.md for the setup + hydration idioms.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (ProjectFlow_Test) — see
 * e2e/README.md. This spec is run by the controller (booting the dev servers
 * needs the specific safe DB env); do not run it ad hoc against any other target.
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

test.describe('Phase 8a — time tracking', () => {
  test('drawer: start the global timer, stop it (timer-sourced log appears), then set an estimate', async ({
    browser,
  }) => {
    const suffix   = uniqSuffix();
    const password = 'E2EPass123!';
    const email    = `time-${suffix}@projectflow.test`;
    const name     = `Time User ${suffix}`;
    // Distinctive, single-occurrence title so getByText can't false-match.
    const title = `Time tracked task ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register + login (API) ─────────────────────────────────────────────
    expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
    const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(login.status(), 'login').toBe(200);
    const { data: { token } } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 2. Workspace → project (Space) → list ─────────────────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, {
      headers, data: { name: `Time WS ${suffix}`, slug: `time-ws-${suffix}` },
    })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers,
      data: { workspaceId, name: `Time Project ${suffix}`, key: `TT${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
    })).json()).data;
    const projectId: string = project.Id ?? project.id;
    expect(projectId, 'projectId').toBeTruthy();

    // A List under the Space. The task is created INTO this list so its
    // object-level task GET routes resolve (the drawer's worklog/estimate loaders
    // are gated by object-level VIEW on the task's List). A list-scoped task still
    // bridges ProjectId to the List's Space, so it renders on the project board.
    const list = (await (await api.post(`${API_BASE}/lists`, {
      headers, data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
    })).json()).data;
    const listId: string = list.id ?? list.Id;
    expect(listId, 'listId').toBeTruthy();

    // ── 3. One task ───────────────────────────────────────────────────────────
    const taskRes = await api.post(`${API_BASE}/tasks`, { headers, data: { workspaceId, listId, title } });
    expect(taskRes.status(), 'create task').toBe(201);
    const taskBody = (await taskRes.json()).data;
    const taskId: string = String(taskBody.Id ?? taskBody.id);
    expect(taskId, 'taskId').toBeTruthy();

    // ── 4. Open the task in the board drawer ──────────────────────────────────
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, email, password);
    await page.goto('/board');

    await expect(page.getByRole('region', { name: /kanban board/i })).toBeVisible({ timeout: 20_000 });

    // Click the card to open its drawer. Retry the open-click to absorb the
    // SSR→hydration gap (the card can be present before its onClick is wired).
    // The drawer is a role="dialog" carrying the task title; the WorkLogSection's
    // "Log work" toggle confirms the task panel mounted.
    const drawer = page.getByRole('dialog').filter({ hasText: title });
    const logWorkBtn = drawer.getByRole('button', { name: /log work/i });
    await expect(async () => {
      const card = page.getByText(title, { exact: false }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.click();
      await expect(logWorkBtn).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });

    // ── 5. Log work → Start timer ─────────────────────────────────────────────
    await logWorkBtn.click();
    const startTimerBtn = drawer.getByRole('button', { name: /start timer/i });
    await expect(startTimerBtn).toBeVisible({ timeout: 10_000 });
    await startTimerBtn.click();

    // ── 6. The global timer widget appears in the header, ticking ─────────────
    const widget = page.getByLabel(/timer running/i);
    await expect(widget).toBeVisible({ timeout: 20_000 });
    // Live elapsed text: "0:00" / "2:05" / "1:01:01" — matches /^\d+:\d{2}/.
    await expect(widget.getByText(/^\d+:\d{2}/)).toBeVisible({ timeout: 10_000 });

    // ── 7. Stop the timer → widget hides; the timer-sourced entry appears ─────
    // The header widget is visually behind the open TaskDrawer (the drawer header
    // intercepts pointer events at the widget's coordinates), so a coordinate click
    // — even forced — lands on the drawer. Dispatch the DOM click straight at the
    // Stop button so its React handler runs regardless of overlay.
    await widget.getByRole('button', { name: /^stop$/i }).dispatchEvent('click');
    await expect(widget).toBeHidden({ timeout: 20_000 });

    // The just-closed entry surfaces in the WorkLogSection list tagged
    // data-worklog-source="timer" (the 'worklog:timer-changed' event refetches).
    await expect(page.locator('[data-worklog-source="timer"]').first()).toBeVisible({ timeout: 20_000 });

    // ── 8. Set an estimate → the estimate bar legend renders ──────────────────
    // Scope to the TaskEstimateBar root so its "Set estimate"/"Save" don't collide
    // with the WorkLogSection's own Save button (both read "Save").
    const estimateBar = page.locator('[data-estimate-bar]');
    await expect(estimateBar).toBeVisible({ timeout: 20_000 });
    await estimateBar.getByRole('button', { name: /set estimate/i }).click();
    await estimateBar.getByPlaceholder('2h 30m').fill('1h');
    await estimateBar.getByRole('button', { name: /^save$/i }).click();

    // The bar legend ("Logged …") confirms the estimate round-trip refreshed the
    // rollup. The timer entry above already gave us a non-zero logged total, but
    // the legend renders regardless once the rollup row is present.
    await expect(page.getByText(/logged/i).first()).toBeVisible({ timeout: 20_000 });

    // ── 9. Cleanup ────────────────────────────────────────────────────────────
    await ctx.close();
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
