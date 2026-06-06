/**
 * E2E: Relationships + Rollup (Phase 5b, Batch 3).
 *
 * Proves the Phase 5b acceptance end-to-end through the browser UI:
 *   "a list-to-list relationship + a rollup shows a value pulled from related
 *    tasks."
 *
 * One authed user seeds (over REST) a Space (project) with two lists, a task A
 * in list A, and two tasks B1/B2 in list B whose builtin `storyPoints` are 3 and
 * 5. It then creates, on the SPACE scope, a `relationship` custom field targeting
 * list B and a `rollup` custom field that SUMs `storyPoints` across the related
 * tasks, and links A → B1 and A → B2 over the dedicated relationship route. The
 * browser then opens task A's board drawer and asserts (auto-retrying):
 *   1. the relationship field lists B1 and B2 (by title), and
 *   2. the rollup field renders the aggregated value 8 (3 + 5).
 *
 * Why seed/link over REST (not the UI picker):
 *   The relationship picker's search UX + the field-manager creation UX are
 *   covered by unit/integration tests. Seeding the graph + the rollup config over
 *   the API makes the "drawer shows B1/B2 and the total 8" precondition
 *   deterministic and keeps the spec fast. What's under test here is the DRAWER
 *   RENDERING the linked tasks and the server-computed rollup total.
 *
 * Why no cookie/selection juggling for the board scope:
 *   The user is a member of exactly ONE workspace containing exactly ONE project,
 *   so `/board` auto-scopes to it (resolveActiveId defaults to first). Task A is
 *   list-scoped under that Space, so it bridges ProjectId and renders as a board
 *   card; clicking it opens the drawer. The custom fields are SPACE-scoped, so
 *   they appear in task A's drawer "Custom Fields" section.
 *
 * Builtin `storyPoints` is set directly at task creation (POST /tasks accepts it)
 * so no out-of-band SQL is needed. All post-action assertions use auto-retrying
 * `expect`, so React hydration + the effective-fields fetch settle without fixed
 * sleeps. See e2e/dependencies.spec.ts / e2e/live-board.spec.ts / e2e/README.md
 * for the setup + hydration idioms.
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (see e2e/README.md).
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

test('relationships + rollup: drawer lists related tasks and shows the summed rollup (8)', async ({
  browser,
}) => {
  const suffix   = uniqSuffix();
  const password = 'E2EPass123!';
  const email    = `rel-${suffix}@projectflow.test`;
  const name     = `Rel User ${suffix}`;
  // Distinctive, single-occurrence titles so getByText can't false-match.
  const titleA  = `Rel parent ${suffix}`;
  const titleB1 = `Rel child one ${suffix}`;
  const titleB2 = `Rel child two ${suffix}`;
  // Distinctive field names so the drawer label / chip scoping is unambiguous.
  const relFieldName    = `Linked items ${suffix}`;
  const rollupFieldName = `Points total ${suffix}`;

  const api = await playwrightRequest.newContext();

  // ── 1. Register + login (API) ───────────────────────────────────────────────
  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status(), 'register').toBe(201);
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(login.status(), 'login').toBe(200);
  const { data: { token } } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  // ── 2. Workspace → project (Space) → list A + list B ────────────────────────
  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `Rel WS ${suffix}`, slug: `rel-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId, 'workspaceId').toBeTruthy();

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers,
    data: { workspaceId, name: `Rel Project ${suffix}`, key: `RL${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const spaceId: string = project.Id ?? project.id;
  expect(spaceId, 'spaceId').toBeTruthy();

  const mkList = async (name: string): Promise<string> => {
    const r = await api.post(`${API_BASE}/lists`, {
      headers, data: { workspaceId, spaceId, folderId: null, name, position: 0 },
    });
    expect(r.status(), `create list ${name}`).toBe(201);
    const l = (await r.json()).data;
    return String(l.id ?? l.Id);
  };
  const listAId = await mkList('List A');
  const listBId = await mkList('List B');

  // ── 3. Tasks: A in list A; B1/B2 in list B with builtin storyPoints 3 & 5 ────
  // Tasks are created INTO a list (not project-only) so the task object-level
  // GET routes (effective fields, relationships) — gated by object-level VIEW on
  // the task's List — resolve. A list-scoped task still bridges ProjectId to the
  // List's Space, so it renders on the project board. storyPoints is accepted on
  // POST /tasks, so the rollup source is seeded inline (no out-of-band SQL).
  const mkTask = async (listId: string, title: string, storyPoints?: number): Promise<string> => {
    const r = await api.post(`${API_BASE}/tasks`, {
      headers, data: { workspaceId, listId, title, ...(storyPoints != null ? { storyPoints } : {}) },
    });
    expect(r.status(), `create ${title}`).toBe(201);
    const t = (await r.json()).data;
    return String(t.Id ?? t.id);
  };
  const taskAId  = await mkTask(listAId, titleA);
  const taskB1Id = await mkTask(listBId, titleB1, 3);
  const taskB2Id = await mkTask(listBId, titleB2, 5);

  // ── 4. Custom fields on the SPACE scope ─────────────────────────────────────
  // (a) relationship field → list-to-list, targeting list B.
  const relFieldRes = await api.post(`${API_BASE}/custom-fields`, {
    headers,
    data: {
      scopeType: 'SPACE', scopeId: spaceId, type: 'relationship', name: relFieldName,
      config: { relationshipTargetType: 'list', relationshipTargetListId: listBId },
    },
  });
  expect(relFieldRes.status(), 'create relationship field').toBe(201);
  const relFieldId: string = (await relFieldRes.json()).data.id;
  expect(relFieldId, 'relFieldId').toBeTruthy();

  // (b) rollup field → SUM of the builtin storyPoints over the relationship.
  const rollupFieldRes = await api.post(`${API_BASE}/custom-fields`, {
    headers,
    data: {
      scopeType: 'SPACE', scopeId: spaceId, type: 'rollup', name: rollupFieldName,
      config: {
        rollupRelationshipFieldId: relFieldId,
        rollupSourceField: { kind: 'builtin', key: 'storyPoints' },
        rollupFunction: 'sum',
      },
    },
  });
  expect(rollupFieldRes.status(), 'create rollup field').toBe(201);
  const rollupFieldId: string = (await rollupFieldRes.json()).data.id;
  expect(rollupFieldId, 'rollupFieldId').toBeTruthy();

  // ── 5. Link A → B1 and A → B2 over the relationship route ───────────────────
  const link = async (toTaskId: string) => {
    const r = await api.post(`${API_BASE}/tasks/${taskAId}/relationships/${relFieldId}`, {
      headers, data: { toTaskId },
    });
    expect(r.status(), `link A → ${toTaskId}`).toBe(201);
  };
  await link(taskB1Id);
  await link(taskB2Id);

  // Sanity (REST): the relationship list reflects both edges and the effective
  // fields already carry the computed rollup total 8 BEFORE we touch the UI.
  const relList = (await (await api.get(`${API_BASE}/tasks/${taskAId}/relationships/${relFieldId}`, { headers })).json()).data;
  const linkedTitles = (relList as { title: string }[]).map((r) => r.title);
  expect(linkedTitles, 'REST: A links B1 + B2').toEqual(expect.arrayContaining([titleB1, titleB2]));

  const effective = (await (await api.get(`${API_BASE}/tasks/${taskAId}/fields`, { headers })).json()).data;
  const rollupEntry = (effective as { field: { id: string }; value: unknown }[])
    .find((e) => String(e.field.id).toUpperCase() === rollupFieldId.toUpperCase());
  expect(rollupEntry, 'REST: rollup field present on A').toBeTruthy();
  expect(rollupEntry!.value, 'REST: rollup sum = 8').toBe(8);

  // ── 6. Open task A in the board drawer ──────────────────────────────────────
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await uiLogin(page, email, password);
  await page.goto('/board');

  await expect(page.getByRole('region', { name: /kanban board/i })).toBeVisible({ timeout: 20_000 });
  // Task A lives in the default "To Do" column. Click its card to open the drawer.
  const cardA = page.getByText(titleA, { exact: false });
  await expect(cardA).toBeVisible({ timeout: 20_000 });
  await cardA.click();

  // The drawer mounts a dialog. Wait for the Custom Fields section's relationship
  // field label to confirm the effective-fields fetch resolved and rendered.
  const drawer = page.getByRole('dialog').filter({ hasText: titleA });
  await expect(drawer.getByText(relFieldName, { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 7a. Relationship field lists B1 and B2 (by title) ───────────────────────
  // RelationshipField renders each linked task as a chip showing its title. B1/B2
  // are NOT board cards in this column (they live in list B, which is not the
  // board's default column flow for task A's column), but to be safe we scope the
  // assertion to the drawer dialog.
  await expect(drawer.getByText(titleB1, { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(drawer.getByText(titleB2, { exact: false })).toBeVisible({ timeout: 20_000 });

  // ── 7b. Rollup field shows the aggregated total 8 (3 + 5) ───────────────────
  // RollupValue renders the server-computed total as plain text. Scope to the
  // rollup field's row (the label + its value live in the same flex row) so we
  // assert the "8" belongs to the rollup field, not some incidental "8" elsewhere.
  const rollupRow = drawer
    .locator('div')
    .filter({ has: page.getByText(rollupFieldName, { exact: true }) })
    .first();
  await expect(rollupRow).toBeVisible({ timeout: 20_000 });
  await expect(rollupRow.getByText('8', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 8. Cleanup ──────────────────────────────────────────────────────────────
  await ctx.close();
  const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
  expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
  await api.dispose();
});
