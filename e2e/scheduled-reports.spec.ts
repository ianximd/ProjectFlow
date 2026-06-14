/**
 * E2E: Phase 9c — Scheduled reports (§6.5 headline flow)
 *
 * Proves a dashboard is delivered on its cadence against the REAL stack
 * (API + local test DB; the sweep runs in-process via the dev endpoint, so no
 * BullMQ/Redis tick is needed):
 *
 *   1. API: register an OWNER + a RECIPIENT (resolve the recipient's id via
 *      /auth/me), then seed workspace → project (Space) → list → one task.
 *   2. API: create a SPACE-scoped dashboard + one calculation card.
 *   3. API: the owner creates a scheduled report (daily, inbox channel) whose
 *      recipient is the OTHER user. (Owner has scheduled_report.manage from the
 *      workspace-owner role seeded by migration 0055.)
 *   4. API: trigger one immediate sweep via POST /dev/scheduled-reports/sweep
 *      { scheduleId } — it forces NextRunAt into the past and runs the pure
 *      runScheduledReportSweep, which snapshots → records a run (idempotent per
 *      PeriodKey) → delivers an inbox notification → advances NextRunAt.
 *   5. HEADLINE: poll GET /scheduled-reports/:id/runs until exactly one DELIVERED
 *      run with a frozen SnapshotRef appears.
 *   6. The RECIPIENT receives a SCHEDULED_REPORT_READY in-app notification
 *      (GET /notifications?types=SCHEDULED_REPORT_READY as the recipient).
 *   7. UI smoke: the owner logs in, opens the frozen snapshot viewer (read-only)
 *      and the dashboard's "Schedule delivery" dialog.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (ProjectFlow_Test) — see
 * e2e/README.md. Run by the controller (booting the dev servers needs the safe env).
 */

import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Log a user in through the UI and wait until the app shell mounts. */
async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

test.describe('Phase 9c — scheduled reports', () => {
  test('schedule a dashboard, sweep, see a delivered run + recipient inbox notification + read-only snapshot', async ({ browser }) => {
    const suffix   = uniqSuffix();
    const password = 'E2EPass123!';
    const ownerEmail = `sr-owner-${suffix}@projectflow.test`;
    const rcptEmail  = `sr-rcpt-${suffix}@projectflow.test`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register owner + recipient, resolve recipient id ───────────────────
    expect((await api.post(`${API_BASE}/auth/register`, { data: { email: ownerEmail, name: `Owner ${suffix}`, password } })).status(), 'register owner').toBe(201);
    const ownerLogin = await api.post(`${API_BASE}/auth/login`, { data: { email: ownerEmail, password } });
    expect(ownerLogin.status(), 'owner login').toBe(200);
    const ownerToken = (await ownerLogin.json()).data.token as string;
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };

    expect((await api.post(`${API_BASE}/auth/register`, { data: { email: rcptEmail, name: `Rcpt ${suffix}`, password } })).status(), 'register recipient').toBe(201);
    const rcptLogin = await api.post(`${API_BASE}/auth/login`, { data: { email: rcptEmail, password } });
    expect(rcptLogin.status(), 'recipient login').toBe(200);
    const rcptToken = (await rcptLogin.json()).data.token as string;
    const rcptHeaders = { Authorization: `Bearer ${rcptToken}` };

    const me = (await (await api.get(`${API_BASE}/auth/me`, { headers: rcptHeaders })).json()).data;
    const recipientId = String(me.id ?? me.Id);
    expect(recipientId, 'recipient id').toBeTruthy();

    // ── 2. Workspace → project (Space) → list → one task ──────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, {
      headers: ownerHeaders, data: { name: `SR WS ${suffix}`, slug: `sr-ws-${suffix}` },
    })).json()).data;
    const workspaceId = String(ws.Id ?? ws.id);
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers: ownerHeaders, data: { workspaceId, name: `SR Project ${suffix}`, key: `SR${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
    })).json()).data;
    const projectId = String(project.Id ?? project.id);
    expect(projectId, 'projectId').toBeTruthy();

    const list = (await (await api.post(`${API_BASE}/lists`, {
      headers: ownerHeaders, data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
    })).json()).data;
    const listId = String(list.id ?? list.Id);
    expect(listId, 'listId').toBeTruthy();

    expect((await api.post(`${API_BASE}/tasks`, { headers: ownerHeaders, data: { workspaceId, listId, title: `SR task ${suffix}` } })).status(), 'create task').toBe(201);

    // ── 3. Space-scoped dashboard + one calculation card ──────────────────────
    const dash = (await (await api.post(`${API_BASE}/dashboards`, {
      headers: ownerHeaders, data: { scopeType: 'space', scopeId: projectId, name: `Weekly status ${suffix}` },
    })).json()).data;
    const dashboardId = String(dash.id ?? dash.Id);
    expect(dashboardId, 'dashboardId').toBeTruthy();

    expect((await api.post(`${API_BASE}/dashboards/${dashboardId}/cards`, {
      headers: ownerHeaders,
      data: { type: 'calculation', title: 'Open tasks', config: { aggregate: { op: 'count' }, filter: { conjunction: 'AND', rules: [] } }, layout: { x: 0, y: 0, w: 4, h: 2 } },
    })).status(), 'create card').toBe(201);

    // ── 4. Owner creates a scheduled report delivering to the RECIPIENT ────────
    const schedRes = await api.post(`${API_BASE}/scheduled-reports`, {
      headers: ownerHeaders,
      data: { workspaceId, dashboardId, cadence: { freq: 'daily', interval: 1 }, deliveryChannel: 'inbox', recipients: [recipientId] },
    });
    expect(schedRes.status(), 'create scheduled report').toBe(201);
    const scheduleId = String((await schedRes.json()).data.id);
    expect(scheduleId, 'scheduleId').toBeTruthy();

    // ── 5. Trigger one immediate sweep via the dev endpoint ───────────────────
    const sweepRes = await api.post(`${API_BASE}/dev/scheduled-reports/sweep`, { headers: ownerHeaders, data: { scheduleId } });
    expect(sweepRes.status(), 'dev sweep').toBe(200);

    // ── 6. HEADLINE: exactly one DELIVERED run with a frozen snapshot ─────────
    let runId = '';
    await expect(async () => {
      const runsRes = await api.get(`${API_BASE}/scheduled-reports/${scheduleId}/runs`, { headers: ownerHeaders });
      expect(runsRes.status(), 'list runs').toBe(200);
      const runs: Array<{ id: string; status: string; snapshotRef: string | null }> = (await runsRes.json()).data;
      const delivered = runs.filter((r) => r.status === 'delivered');
      expect(delivered.length, 'one delivered run').toBe(1);
      expect(delivered[0].snapshotRef, 'frozen snapshot present').toBeTruthy();
      runId = delivered[0].id;
    }).toPass({ timeout: 15_000, intervals: [500, 1000, 1500, 2000, 3000] });

    // ── 7. The recipient received a SCHEDULED_REPORT_READY notification ───────
    await expect(async () => {
      const notifRes = await api.get(`${API_BASE}/notifications?types=SCHEDULED_REPORT_READY&pageSize=50`, { headers: rcptHeaders });
      expect(notifRes.status(), 'recipient notifications').toBe(200);
      const notifs: Array<{ type: string; payload: any }> = (await notifRes.json()).data;
      expect(notifs.length, 'one report notification').toBeGreaterThanOrEqual(1);
      expect(String(notifs[0].payload.scheduledReportId).toUpperCase(), 'notification points at the schedule').toBe(scheduleId.toUpperCase());
    }).toPass({ timeout: 10_000, intervals: [500, 1000, 1500] });

    // ── 8. UI smoke: read-only snapshot viewer + the schedule dialog ──────────
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, ownerEmail, password);

    // 8a. The frozen snapshot viewer renders read-only.
    await page.goto(`/reports/snapshot/${runId}?scheduleId=${scheduleId}`);
    await expect(page.getByText(/read-only/i)).toBeVisible({ timeout: 15_000 });

    // 8b. The dashboard exposes a "Schedule delivery" dialog (SSR→hydration: retry the open).
    await page.goto('/dashboard');
    await expect(async () => {
      await page.getByRole('button', { name: /schedule delivery/i }).first().click();
      await expect(page.getByRole('dialog', { name: /schedule delivery/i })).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 30_000 });

    // ── 9. Cleanup ────────────────────────────────────────────────────────────
    await ctx.close();
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers: ownerHeaders });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
