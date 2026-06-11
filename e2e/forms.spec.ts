/**
 * E2E: Forms (Phase 7c). Proves BUILD_PLAN acceptance §6.5 end-to-end:
 *   "a form with conditional logic hides/shows questions and creates a task on submit."
 *
 * One authed user seeds (REST) a Space → List and a PUBLIC form whose config
 * branches: "steps" is shown only when kind=bug; "summary" maps to the task
 * title. A fresh (UNauthenticated) browser context opens the public renderer at
 * /forms/public/:slug, verifies the branching toggles "steps" by selecting idea
 * vs bug, fills + submits, and the authed API confirms a task landed in the
 * target list with the mapped title.
 *
 * NOTE: the public render route is /forms/public/[slug] (not /forms/[slug],
 * which would collide with the authed builder /forms/[id]).
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (see e2e/README.md).
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniq(): string { return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`; }

test('forms: conditional logic hides/shows questions and submit creates a task', async ({ browser }) => {
  const suffix   = uniq();
  const password = 'E2EPass123!';
  const email    = `form-${suffix}@projectflow.test`;
  const slug     = `intake-${suffix}`;
  const summary  = `Dark mode ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── Register + login (API) ──────────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name: `Form ${suffix}`, password } })).status()).toBe(201);
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email, password } })).json();
  const headers = { Authorization: `Bearer ${token}` };

  // ── Workspace → Space → List ────────────────────────────────────────────────
  const ws = (await (await api.post(`${API_BASE}/workspaces`, { headers, data: { name: `WS ${suffix}`, slug: `ws-${suffix}` } })).json()).data;
  const workspaceId = ws.Id ?? ws.id;
  const project = (await (await api.post(`${API_BASE}/projects`, { headers, data: { workspaceId, name: `P ${suffix}`, key: `FM${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' } })).json()).data;
  const spaceId = project.Id ?? project.id;
  const list = (await (await api.post(`${API_BASE}/lists`, { headers, data: { workspaceId, spaceId, folderId: null, name: 'Intake', position: 0 } })).json()).data;
  const listId = list.id ?? list.Id;

  // ── Public form with conditional logic ──────────────────────────────────────
  const config = {
    fields: [
      { key: 'summary', label: 'Summary', type: 'short_text', required: true },
      { key: 'kind',    label: 'Kind',    type: 'select',     required: true, options: ['bug', 'idea'] },
      { key: 'steps',   label: 'Steps',   type: 'long_text',  required: true },
    ],
    branching: [
      { fieldKey: 'steps', action: 'show', when: { fieldKey: 'kind', op: 'equals', value: 'bug' } },
    ],
  };
  const formRes = await api.post(`${API_BASE}/forms`, {
    headers,
    data: {
      workspaceId, scopeType: 'LIST', scopeId: listId, name: 'Public Intake',
      config, targetListId: listId,
      fieldMapping: { summary: { kind: 'task', target: 'title' } },
      isPublic: true, publicSlug: slug, authRequired: false,
    },
  });
  expect(formRes.status(), 'create form').toBe(201);

  // ── Browser: render the PUBLIC form (no login) ──────────────────────────────
  const ctx  = await browser.newContext();   // fresh — no session cookie
  const page = await ctx.newPage();
  await page.goto(`/forms/public/${slug}`);

  await expect(page.getByRole('heading', { name: 'Public Intake' })).toBeVisible({ timeout: 15_000 });

  // "steps" is HIDDEN initially (kind unset) and for "idea".
  const stepsField = page.locator('[data-field-key="steps"]');
  await expect(stepsField).toHaveCount(0);

  await page.locator('[data-field-key="kind"] select').selectOption('idea');
  await expect(stepsField).toHaveCount(0);   // still hidden for idea

  // Selecting "bug" REVEALS "steps".
  await page.locator('[data-field-key="kind"] select').selectOption('bug');
  await expect(stepsField).toBeVisible();

  // Fill + submit.
  await page.locator('[data-field-key="summary"] input').fill(summary);
  await page.locator('[data-field-key="steps"] textarea').fill('Open app, it crashes.');
  await page.getByRole('button', { name: /submit/i }).click();

  // Thank-you state.
  await expect(page.getByText(/thanks/i)).toBeVisible({ timeout: 15_000 });

  // ── API proof: a task with the mapped title landed in the target list ────────
  await expect.poll(async () => {
    const tasks = (await (await api.get(`${API_BASE}/hierarchy/everything?nodeType=LIST&nodeId=${listId}`, { headers })).json()).data as any[];
    return tasks.map((t) => t.Title ?? t.title);
  }, { message: 'submitted task in target list', timeout: 20_000 }).toContain(summary);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  await ctx.close();
  const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
  expect([204, 404]).toContain(wsDel.status());
  await api.dispose();
});
