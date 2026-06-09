/**
 * E2E: Phase 6d — Automation Template Gallery / Metering
 *
 * Two tests in one describe block:
 *
 * TEST 1 ("templates localize + a template instantiates + fires + meters") is
 * API-driven and proves the templates/metering BACKEND end-to-end over the real
 * HTTP+worker stack — matching the existing automation e2e convention
 * (automations.spec.ts, automation-conditions.spec.ts, automation-scheduler.spec.ts).
 * It covers: Accept-Language localization of GET /automations/templates,
 * POST /automations from a template's trigger/conditions/actions, BullMQ worker
 * execution of TASK_CREATED → ASSIGN REPORTER, and GET /automations/usage metering.
 * Polling with auto-retrying expect avoids fixed sleeps.
 *
 * TEST 2 ("the gallery renders the catalog and pre-fills the builder") is a
 * browser-driven UI test that proves the genuinely-new gallery UI: the
 * "Browse templates" button opens the TemplateGallery dialog, at least 15 "Use
 * template" cards are visible, and clicking one pre-fills the create-rule dialog
 * name input with the template's title. The run-history drawer's data path and
 * worker correctness are covered by the integration tests + TEST 1, so TEST 2
 * stays worker-independent.
 *
 * Operational notes
 * ─────────────────
 * 1. Requires a running BullMQ worker + Redis + local Docker ProjectFlow_Test DB
 *    (NOT prod). See e2e/README.md and the safe local-DB run pattern in
 *    docs/superpowers/memory/phase6-10-execution.md.
 * 2. Run ONLY with explicit local DB env (DB_SERVER=localhost …
 *    DB_NAME=ProjectFlow_Test) so it never touches prod.
 * 3. TEST 1's ASSIGN action is async (BullMQ); step 6 polls with toPass.
 */

import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Register → login → workspace → project(KANBAN) → list. Returns everything needed. */
async function apiSetup(suffix: string): Promise<{
  api: APIRequestContext;
  token: string;
  headers: Record<string, string>;
  userId: string;
  workspaceId: string;
  projectId: string;
  listId: string;
  email: string;
  password: string;
}> {
  const email = `e2e-tpl-${suffix}@projectflow.test`;
  const password = 'E2EPass123!';
  const api = await playwrightRequest.newContext();

  expect(
    (await api.post(`${API_BASE}/auth/register`, { data: { email, name: `Tpl User ${suffix}`, password } })).status(),
    'register',
  ).toBe(201);

  const loginRes = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(loginRes.status(), 'login').toBe(200);
  const { data: { token } } = await loginRes.json();
  const headers = { Authorization: `Bearer ${token}` };

  const meRes = await api.get(`${API_BASE}/auth/me`, { headers });
  expect(meRes.status(), '/auth/me').toBe(200);
  const meBody = (await meRes.json()).data;
  const userId: string = meBody.Id ?? meBody.id;
  expect(userId, 'userId resolved').toBeTruthy();

  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `Tpl WS ${suffix}`, slug: `tpl-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId, 'workspaceId').toBeTruthy();

  const proj = (await (await api.post(`${API_BASE}/projects`, {
    headers,
    data: {
      workspaceId,
      name: `Tpl Project ${suffix}`,
      key: `TP${suffix.slice(-4).toUpperCase()}`,
      type: 'KANBAN',
    },
  })).json()).data;
  const projectId: string = proj.Id ?? proj.id;
  expect(projectId, 'projectId').toBeTruthy();

  const listBody = (await (await api.post(`${API_BASE}/lists`, {
    headers,
    data: { workspaceId, spaceId: projectId, folderId: null, name: 'Default', position: 0 },
  })).json()).data;
  const listId: string = listBody.id ?? listBody.Id;
  expect(listId, 'listId').toBeTruthy();

  return { api, token, headers, userId, workspaceId, projectId, listId, email, password };
}

test.describe('Phase 6d — automation template gallery + metering', () => {
  // ── TEST 1: API-driven — templates localize + instantiate + fire + meter ───────
  test('templates localize + a template instantiates + fires + meters', async () => {
    const suffix = uniqSuffix();
    const { api, headers, userId, workspaceId, projectId, listId } = await apiSetup(suffix);

    // ── 1. GET templates in English ───────────────────────────────────────────
    const enRes = await api.get(`${API_BASE}/automations/templates`, {
      headers: { ...headers, 'Accept-Language': 'en' },
    });
    expect(enRes.status(), 'GET templates (en)').toBe(200);
    const enBody = await enRes.json();
    const enTemplates: Array<{ key: string; title: string; trigger: unknown; conditions: unknown; actions: unknown }> =
      enBody.templates;

    // Catalog is in the 15–20 band
    expect(enTemplates.length, 'template count in 15–20 band').toBeGreaterThanOrEqual(15);
    expect(enTemplates.length, 'template count in 15–20 band').toBeLessThanOrEqual(20);

    // Known key exists
    const enTpl = enTemplates.find((t) => t.key === 'auto-assign-on-create');
    expect(enTpl, 'auto-assign-on-create template present').toBeTruthy();
    const enTitle = enTpl!.title;
    expect(enTitle, 'English title is non-empty').toBeTruthy();

    // ── 2. GET templates in Indonesian → same key has a different title ────────
    const idRes = await api.get(`${API_BASE}/automations/templates`, {
      headers: { ...headers, 'Accept-Language': 'id' },
    });
    expect(idRes.status(), 'GET templates (id)').toBe(200);
    const idBody = await idRes.json();
    const idTemplates: Array<{ key: string; title: string }> = idBody.templates;

    const idTpl = idTemplates.find((t) => t.key === 'auto-assign-on-create');
    expect(idTpl, 'auto-assign-on-create present in id response').toBeTruthy();
    expect(idTpl!.title, 'Indonesian title differs from English (server localizes)').not.toBe(enTitle);

    // ── 3. Instantiate the template: POST /automations with template payload ───
    const ruleRes = await api.post(`${API_BASE}/automations`, {
      headers,
      data: {
        scopeType: 'PROJECT',
        workspaceId,
        projectId,
        name: 'From gallery template',
        trigger: enTpl!.trigger,
        conditions: enTpl!.conditions,
        actions: enTpl!.actions,
      },
    });
    expect(ruleRes.status(), 'create automation from template').toBe(201);
    const ruleBody = await ruleRes.json();
    const rule = ruleBody.rule;
    const ruleId: string = String(rule.id);
    expect(ruleId, 'ruleId').toBeTruthy();

    // The instantiated rule preserves the template's shape
    expect((rule.trigger as { type: string }).type, 'trigger.type').toBe('TASK_CREATED');
    expect(
      (rule.actions as Array<{ type: string }>)[0]?.type,
      'first action type',
    ).toBe('ASSIGN');

    // ── 4. Fire the rule: create a task (reporter = logged-in user) ────────────
    const taskRes = await api.post(`${API_BASE}/tasks`, {
      headers,
      data: { workspaceId, listId, title: `Gallery template task ${suffix}` },
    });
    expect(taskRes.status(), 'create task').toBe(201);

    // ── 5. Poll run history until a TASK_CREATED success run is recorded ───────
    // The ASSIGN action executes in the BullMQ worker asynchronously.
    await expect(async () => {
      const runsRes = await api.get(`${API_BASE}/automations/${ruleId}/runs`, { headers });
      expect(runsRes.status(), 'list runs').toBe(200);
      const runs: Array<{ status: string; triggerType: string }> = (await runsRes.json()).runs;
      const run = runs.find((r) => r.triggerType === 'TASK_CREATED');
      expect(run, 'a TASK_CREATED run was recorded').toBeTruthy();
      expect(run!.status, 'run status').toBe('success');
    }).toPass({ timeout: 20_000, intervals: [500, 1000, 1500, 2000, 3000] });

    // ── 6. GET usage → period matches YYYYMM and runCount >= 1 ────────────────
    const usageRes = await api.get(`${API_BASE}/automations/usage?workspaceId=${workspaceId}`, { headers });
    expect(usageRes.status(), 'GET usage').toBe(200);
    const usage = (await usageRes.json()).usage;
    expect(usage.period, 'period is YYYYMM').toMatch(/^\d{6}$/);
    expect(usage.runCount, 'runCount >= 1 (the success run was metered)').toBeGreaterThanOrEqual(1);

    // ── Cleanup ────────────────────────────────────────────────────────────────
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });

  // ── TEST 2: UI — the gallery renders the catalog and pre-fills the builder ────
  test('the gallery renders the catalog and pre-fills the builder', async ({ page }) => {
    const suffix = uniqSuffix();
    const { api, email, password } = await apiSetup(suffix);

    // ── 1. Browser-login through the real login UI (mirrors views.spec.ts) ─────
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 15_000 });

    // ── 2. Navigate to /automations ────────────────────────────────────────────
    await page.goto('/automations');

    // ── 3. Open the gallery. Retry the click to ride out client hydration: the
    // SSR button is visible (and clickable) before React attaches its onClick, so
    // a single early click can be a no-op. setGalleryOpen(true) is idempotent, so
    // re-clicking is safe. Locate the dialog by its title text (the app convention;
    // other specs filter dialogs by hasText, not accessible name). ──────────────
    const browseBtn = page.getByRole('button', { name: /browse templates/i });
    await expect(browseBtn).toBeVisible({ timeout: 15_000 });
    const gallery = page.getByRole('dialog').filter({ hasText: /automation templates/i });
    await expect(async () => {
      await browseBtn.click();
      await expect(gallery).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000, intervals: [500, 1000, 1500] });

    // ── 4. At least 15 "Use template" cards render (18-template catalog) ────────
    await expect(async () => {
      const count = await gallery.getByRole('button', { name: /use template/i }).count();
      expect(count, 'at least 15 Use template buttons visible').toBeGreaterThanOrEqual(15);
    }).toPass({ timeout: 10_000, intervals: [300, 600, 1000] });

    // ── 5. Use the first template → the gallery closes and the create "rule"
    // dialog opens PRE-FILLED. One dialog shows at a time; exclude the gallery by
    // its title text so the locator resolves to exactly the create dialog. ──────
    await gallery.getByRole('button', { name: /use template/i }).first().click();
    const createDialog = page.getByRole('dialog').filter({ hasNotText: /automation templates/i });
    await expect(createDialog).toBeVisible({ timeout: 10_000 });

    // The name input in the create dialog must have a non-empty value (template title seeded it).
    const nameInput = createDialog.getByRole('textbox').first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await expect(async () => {
      const val = await nameInput.inputValue();
      expect(val, 'rule name input is pre-filled with the template title').toBeTruthy();
    }).toPass({ timeout: 5_000, intervals: [200, 500] });

    // ── Cleanup ────────────────────────────────────────────────────────────────
    await api.dispose();
  });
});
