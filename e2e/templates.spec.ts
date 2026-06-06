/**
 * E2E: Templates (Phase 5d, Batch 4).
 *
 * Proves the Phase 5d acceptance (spec §6) end-to-end through the live app:
 *   "applying a list template recreates tasks, fields, views, and remaps dates."
 *
 * One authed user seeds (over REST + one GraphQL mutation) a Space → a List
 * with 2 tasks (one dated), a LIST-scoped custom field (with a value on the
 * dated task), and a shared saved view on the LIST. It then CAPTURES the list as
 * a template (POST /templates) and APPLIES it into the Space under a fresh
 * anchor (POST /templates/:id/apply). The assertions (auto-retrying) confirm,
 * through the live REST + GraphQL API, that the apply produced a NEW list under
 * the Space carrying:
 *   - both tasks recreated,
 *   - the custom-field DEFINITION recreated (fresh id),
 *   - the saved view recreated,
 *   - the custom-field VALUE carried onto the right recreated task,
 *   - the dated task's due date REMAPPED relative to the chosen anchor.
 *
 * Then it opens the Template Center page (/templates) in the browser and asserts
 * the captured template is listed — proving the running app serves the feature.
 *
 * Why seed/capture/apply over the API (not the UI modals):
 *   The SaveAsTemplate + ApplyTemplate modal UX is covered by unit/integration
 *   tests; the load-bearing behavior under test here is the APPLY ENGINE
 *   recreating the subtree + remapping dates, which is deterministic and fast to
 *   prove over the live API. The browser step proves the app renders the result.
 *
 * Views have no REST surface — they're GraphQL — so the saved view is created
 * via the `createSavedView` mutation and read back via the `savedViews` query
 * (endpoint /api/v1/graphql). Everything else (space/list/task/custom-field) is
 * REST. Custom-field VALUES are read back via GET /tasks/:id/fields. The new
 * list's tasks are read back via GET /hierarchy/everything?nodeType=LIST.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (see e2e/README.md).
 */

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const GQL_URL  = `${API_BASE}/graphql`;

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Log a user in through the UI and wait until they leave /login. */
async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

/** Minimal GraphQL client over the authed API context. Throws on GraphQL errors. */
async function gql<T = any>(
  api: APIRequestContext,
  headers: Record<string, string>,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await api.post(GQL_URL, { headers, data: { query, variables } });
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

/** UTC-midnight epoch of a date/ISO string (offsets are whole-day, anchor-relative). */
function dayMs(d: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

test('templates: applying a LIST template recreates tasks, fields, views, and remaps dates', async ({
  browser,
}) => {
  const suffix   = uniqSuffix();
  const password = 'E2EPass123!';
  const email    = `tpl-${suffix}@projectflow.test`;
  const name     = `Tpl User ${suffix}`;
  // Distinctive, single-occurrence names so assertions can't false-match.
  const datedTitle = `Tpl dated ${suffix}`;
  const plainTitle = `Tpl plain ${suffix}`;
  const fieldName  = `Effort ${suffix}`;
  const viewName   = `Sprint Board ${suffix}`;
  const tplName    = `Sprint Template ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── 1. Register + login (API) ───────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(login.status(), 'login').toBe(200);
  const { data: { token } } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  // ── 2. Workspace → project (Space) ──────────────────────────────────────────
  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `Tpl WS ${suffix}`, slug: `tpl-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId, 'workspaceId').toBeTruthy();

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers,
    data: { workspaceId, name: `Tpl Project ${suffix}`, key: `TP${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const spaceId: string = project.Id ?? project.id;
  expect(spaceId, 'spaceId').toBeTruthy();

  // ── 3a. A List under the Space ──────────────────────────────────────────────
  const listRes = await api.post(`${API_BASE}/lists`, {
    headers, data: { workspaceId, spaceId, folderId: null, name: 'Sprint Backlog', position: 0 },
  });
  expect(listRes.status(), 'create list').toBe(201);
  const srcList = (await listRes.json()).data;
  const srcListId: string = srcList.id ?? srcList.Id;
  expect(srcListId, 'srcListId').toBeTruthy();

  // ── 3b. Two tasks (one with a due date set via the create payload) ───────────
  const due = new Date('2026-07-10T00:00:00.000Z');
  const mkTask = async (title: string, dueDate?: string): Promise<string> => {
    const r = await api.post(`${API_BASE}/tasks`, {
      headers, data: { workspaceId, listId: srcListId, title, ...(dueDate ? { dueDate } : {}) },
    });
    expect(r.status(), `create ${title}`).toBe(201);
    const t = (await r.json()).data;
    return String(t.Id ?? t.id);
  };
  const datedTaskId = await mkTask(datedTitle, due.toISOString());
  await mkTask(plainTitle);

  // ── 3c. A LIST-scoped custom field, with a value on the dated task ──────────
  const cfRes = await api.post(`${API_BASE}/custom-fields`, {
    headers, data: { scopeType: 'LIST', scopeId: srcListId, type: 'number', name: fieldName, required: false, position: 0 },
  });
  expect(cfRes.status(), 'create custom field').toBe(201);
  const srcFieldId: string = (await cfRes.json()).data.id;
  expect(srcFieldId, 'srcFieldId').toBeTruthy();

  const setVal = await api.put(`${API_BASE}/tasks/${datedTaskId}/fields/${srcFieldId}`, {
    headers, data: { value: 5 },
  });
  expect(setVal.status(), 'set custom-field value').toBe(200);

  // ── 3d. A shared saved view on the LIST (GraphQL — no REST surface) ──────────
  const created = await gql<{ createSavedView: { id: string } }>(api, headers, /* GraphQL */ `
    mutation ($input: CreateSavedViewInput!) {
      createSavedView(input: $input) { id name type scopeType }
    }`, {
    input: {
      scopeType: 'LIST', scopeId: srcListId, type: 'board', name: viewName,
      isShared: true, isDefault: false,
      config: JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] }),
    },
  });
  expect(created.createSavedView.id, 'srcViewId').toBeTruthy();

  // ── 4. Capture the LIST as a template ───────────────────────────────────────
  const capRes = await api.post(`${API_BASE}/templates`, {
    headers, data: { scopeType: 'LIST', sourceId: srcListId, name: tplName },
  });
  expect(capRes.status(), 'capture template').toBe(201);
  const tpl = (await capRes.json()).data;
  const tplId: string = tpl.id ?? tpl.Id;
  expect(tplId, 'tplId').toBeTruthy();

  // ── 5. Apply the template into the Space under a chosen anchor ───────────────
  const anchor = '2026-09-01T00:00:00.000Z';
  const applyRes = await api.post(`${API_BASE}/templates/${tplId}/apply`, {
    headers, data: { targetParentId: spaceId, anchorDate: anchor },
  });
  expect(applyRes.status(), 'apply template').toBe(201);
  const result = (await applyRes.json()).data as {
    rootId: string;
    counts: { lists: number; tasks: number; views: number; fields: number };
  };
  expect(result.rootId, 'apply rootId').toBeTruthy();
  expect(result.counts).toMatchObject({ lists: 1, tasks: 2, views: 1, fields: 1 });

  const newListId = result.rootId;
  // The new list is FRESH (distinct from the source).
  expect(newListId.toUpperCase()).not.toBe(srcListId.toUpperCase());

  // ── 6. REST assertions: the new list under the Space carries the subtree ─────
  // 6a. A NEW list exists under the Space and matches rootId.
  await expect.poll(async () => {
    const lists = (await (await api.get(`${API_BASE}/lists?spaceId=${spaceId}`, { headers })).json()).data as any[];
    const match = lists.find((l) => String(l.Id ?? l.id).toUpperCase() === newListId.toUpperCase());
    return match ? String(match.Name ?? match.name) : null;
  }, { message: 'new list exists under Space', timeout: 20_000 }).toBe('Sprint Backlog');

  // 6b. Both tasks recreated; the dated task's due date REMAPPED onto the anchor.
  // The captured offset = source due − the template's snapshot anchor; apply
  // remaps onto our chosen anchor. The snapshot JSON is exposed only over GraphQL
  // (the REST metadata read deliberately omits it), so read dueOffset from there
  // to compute the exact expected remapped day.
  const tplDetail = await gql<{ template: { snapshot: string } }>(api, headers, /* GraphQL */ `
    query ($id: String!) { template(id: $id) { snapshot } }`, { id: tplId });
  const snap = JSON.parse(tplDetail.template.snapshot);
  const datedNode = (snap.root.tasks as any[]).find((n) => n.title === datedTitle);
  expect(datedNode, 'snapshot dated node').toBeTruthy();
  const expectedDueDay = Date.UTC(2026, 8, 1) + (datedNode.dueOffset as number) * 24 * 60 * 60 * 1000;

  // Poll until both tasks are present (apply is best-effort/async on sub-objects).
  const tasksOfNewList = async (): Promise<any[]> =>
    (await (await api.get(
      `${API_BASE}/hierarchy/everything?nodeType=LIST&nodeId=${newListId}`, { headers },
    )).json()).data as any[];
  await expect.poll(async () => (await tasksOfNewList()).length, {
    message: 'both tasks recreated', timeout: 20_000,
  }).toBe(2);

  const tasks = await tasksOfNewList();
  expect(tasks.map((t) => t.Title ?? t.title).sort(), 'recreated task titles')
    .toEqual([datedTitle, plainTitle].sort());
  const newDated = tasks.find((t) => (t.Title ?? t.title) === datedTitle);
  expect(newDated, 'recreated dated task').toBeTruthy();
  // Due date remapped onto the chosen anchor (whole-day comparison).
  expect(dayMs(newDated.DueDate ?? newDated.dueDate), 'dated due remapped to anchor').toBe(expectedDueDay);
  const newDatedId = String(newDated.Id ?? newDated.id);

  // 6c. The custom-field DEFINITION recreated on the new list (fresh id).
  await expect.poll(async () => {
    const defs = (await (await api.get(
      `${API_BASE}/custom-fields?scopeType=LIST&scopeId=${newListId}`, { headers },
    )).json()).data as any[];
    const f = defs.find((d) => d.name === fieldName && d.type === 'number');
    // Fresh def id (not the source field id).
    return f && String(f.id).toUpperCase() !== srcFieldId.toUpperCase() ? 'ok' : null;
  }, { message: 'custom-field def recreated (fresh id)', timeout: 20_000 }).toBe('ok');

  // 6d. The custom-field VALUE carried onto the recreated dated task.
  await expect.poll(async () => {
    const eff = (await (await api.get(`${API_BASE}/tasks/${newDatedId}/fields`, { headers })).json()).data as any[];
    const entry = eff.find((e) => e.field?.name === fieldName);
    return entry ? entry.value : null;
  }, { message: 'custom-field value carried', timeout: 20_000 }).toBe(5);

  // 6e. The saved view recreated on the new list scope (GraphQL read-back).
  await expect.poll(async () => {
    const data = await gql<{ savedViews: { name: string; type: string }[] }>(api, headers, /* GraphQL */ `
      query ($scopeType: String!, $scopeId: String) {
        savedViews(scopeType: $scopeType, scopeId: $scopeId) { name type }
      }`, { scopeType: 'LIST', scopeId: newListId });
    return data.savedViews.some((v) => v.name === viewName && v.type === 'board') ? 'ok' : null;
  }, { message: 'saved view recreated on new list', timeout: 20_000 }).toBe('ok');

  // ── 7. Browser proof: the Template Center serves the captured template ───────
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await uiLogin(page, email, password);
  await page.goto('/templates');

  // The Template Center lists each template's name as text. Assert our uniquely
  // named template renders — proving the running app serves the feature.
  await expect(page.getByText(tplName, { exact: false })).toBeVisible({ timeout: 20_000 });

  // ── 8. Cleanup ──────────────────────────────────────────────────────────────
  await ctx.close();
  const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
  expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
  await api.dispose();
});
