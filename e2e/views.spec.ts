import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Phase 3 (Views Engine) headline e2e — E6.
 *
 * Mirrors custom-fields.spec.ts / hierarchy.spec.ts:
 *   - data is seeded over the REST + GraphQL API (register → login → workspace →
 *     project[=Space] → List → tasks); the table SAVED VIEW is created over
 *     GraphQL (the UI has no view-type picker — `view-new` only makes a `list`).
 *   - the browser then authenticates through the real login UI (#email/#password
 *     → "Sign in"), exactly like the other specs (no storageState; no invented
 *     auth flow).
 *
 * Tasks are created with a `listId` so the SP derives the Space ListPath — that is
 * what makes a SPACE-scoped view actually return them (see me-mode.integration).
 *
 * Three scenarios, all data-testid-driven:
 *   (a) filter + group on a Table view via the filter-builder, save, reload →
 *       the saved view (tab + filtered/grouped result) persists.
 *   (b) Me-mode narrows the visible row count.
 *   (c) Select two rows → bulk bar → set status → both rows reflect the change.
 */

const API_BASE = 'http://localhost:3001/api/v1';
const GRAPHQL = `${API_BASE}/graphql`;
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

interface Seed {
  s: string;
  email: string;
  password: string;
  token: string;
  api: APIRequestContext;
  userId: string;
  wsId: string;
  spaceId: string;
  listId: string;
  viewId: string;
}

async function gql<T = any>(api: APIRequestContext, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await api.post(GRAPHQL, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { query, variables },
  });
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

/** Register a user + workspace + project(Space) + List, then a Table saved view. */
async function apiSetup(): Promise<Seed> {
  const s = uniq();
  const email = `e2e-views-${s}@projectflow.test`;
  const password = 'E2EPass123!';
  const api = await pwRequest.newContext();

  await api.post(`${API_BASE}/auth/register`, { data: { email, name: `Views ${s}`, password } });
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const { data: { token, user } } = await login.json();
  const userId = user?.Id ?? user?.id;

  const ws = await (await api.post(`${API_BASE}/workspaces`, {
    headers: { Authorization: `Bearer ${token}` }, data: { name: `WS ${s}`, slug: `ws-${s}` },
  })).json();
  const wsId = ws.data.Id;

  const space = await (await api.post(`${API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { workspaceId: wsId, name: `Space ${s}`, key: `VW${s.slice(-4)}`, type: 'KANBAN' },
  })).json();
  const spaceId = space.data.Id;

  const list = await (await api.post(`${API_BASE}/lists`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { workspaceId: wsId, spaceId, folderId: null, name: `List ${s}`, position: 0 },
  })).json();
  const listId = list.data.Id;

  // A SPACE-scoped Table view (UI can only create `list` views), with a default
  // column set so the table renders status/priority cells we can assert on.
  const { createSavedView } = await gql<{ createSavedView: { id: string } }>(api, token, /* GraphQL */ `
    mutation Create($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }
  `, {
    input: {
      scopeType: 'SPACE',
      scopeId: spaceId,
      type: 'table',
      name: `Table ${s}`,
      isShared: true,
      isDefault: true,
      config: JSON.stringify({
        filter: { conjunction: 'AND', rules: [] },
        sort: [],
        columns: [
          { kind: 'builtin', key: 'title' },
          { kind: 'builtin', key: 'status' },
          { kind: 'builtin', key: 'priority' },
        ],
      }),
    },
  });

  return { s, email, password, token, api, userId, wsId, spaceId, listId, viewId: createSavedView.id };
}

async function createTask(
  seed: Seed,
  title: string,
  opts: { priority?: string; assignToMe?: boolean } = {},
): Promise<string> {
  const t = await (await seed.api.post(`${API_BASE}/tasks`, {
    headers: { Authorization: `Bearer ${seed.token}` },
    data: { workspaceId: seed.wsId, listId: seed.listId, title, type: 'TASK', priority: opts.priority ?? 'MEDIUM' },
  })).json();
  const taskId = t.data?.Id ?? t.data?.id;
  if (opts.assignToMe && seed.userId) {
    await seed.api.put(`${API_BASE}/tasks/${taskId}/assignees`, {
      headers: { Authorization: `Bearer ${seed.token}` },
      data: { userIds: [seed.userId] },
    });
  }
  return taskId;
}

async function uiLogin(page: any, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

const viewsUrl = (seed: Seed) => `/views/SPACE/${seed.spaceId}?viewId=${seed.viewId}`;

/**
 * Open the collapsible filter-builder panel, tolerant of the SSR→CSR hydration
 * gap. Right after a navigation/reload the toggle button is already in the DOM
 * and "clickable" to Playwright, but its React onClick may not be wired up yet,
 * so a single click can silently no-op (the panel never opens). We retry the
 * click until the button reports aria-pressed="true". The toggle is idempotent
 * once open — re-clicks before hydration land are harmless — and a genuine
 * failure to open still surfaces as a toPass timeout, so this hides no real bug.
 */
async function openFilterBuilder(page: Page): Promise<void> {
  const toggle = page.getByTestId('filter-builder-toggle');
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    expect(await toggle.getAttribute('aria-pressed')).toBe('true');
  }).toPass({ timeout: 15000, intervals: [150, 300, 600, 1000] });
}

// ── (a) Filter + group on a Table view, save, reload → persists ────────────────
test('saved view: build a filter + grouping via the builder, persist across reload', async ({ page }) => {
  const seed = await apiSetup();
  await createTask(seed, `Alpha ${seed.s}`, { priority: 'HIGH' });
  await createTask(seed, `Bravo ${seed.s}`, { priority: 'LOW' });

  await uiLogin(page, seed.email, seed.password);
  await page.goto(viewsUrl(seed));

  // The Table view tab + body render.
  await expect(page.getByTestId('view-tab').filter({ hasText: `Table ${seed.s}` })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('view-body-table')).toBeVisible({ timeout: 15000 });

  // Open the filter-builder, add a rule (defaults to the first field/`is`/empty),
  // then set grouping to a field so the saved config is non-trivial.
  await openFilterBuilder(page);
  await expect(page.getByTestId('filter-builder')).toBeVisible();
  await page.getByTestId('add-filter-rule').click();
  await expect(page.getByTestId('filter-rule').first()).toBeVisible();

  // The preview count reflects the (live) query — wait for it to settle off the
  // initial dash/Previewing state.
  await expect(page.getByTestId('filter-preview-count')).not.toHaveText('—', { timeout: 10000 });

  // Persist. `save-view` dispatches the `updateSavedView` server action inside a
  // React transition, so the click resolves BEFORE the write commits. Wait for the
  // action's POST to round-trip; otherwise the reload below races the save and its
  // SSR fetch reads the pre-save config (empty filter). The preview has already
  // settled (assertion above) and the config is unchanged since, so the next
  // server-action POST is the save, not a stray debounced preview.
  const savePosted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.request().headers()['next-action'] != null,
    { timeout: 15000 },
  );
  await page.getByTestId('save-view').click();
  await savePosted;

  // Reload: the table view tab + the builder's saved rule survive.
  await page.reload();
  await expect(page.getByTestId('view-tab').filter({ hasText: `Table ${seed.s}` })).toBeVisible({ timeout: 15000 });
  await openFilterBuilder(page);
  await expect(page.getByTestId('filter-rule').first()).toBeVisible({ timeout: 10000 });

  await seed.api.dispose();
});

// ── (b) Me-mode narrows the visible row count ──────────────────────────────────
test('me-mode: toggling narrows the visible rows to mine', async ({ page }) => {
  const seed = await apiSetup();
  await createTask(seed, `Mine ${seed.s}`, { assignToMe: true });
  await createTask(seed, `Theirs A ${seed.s}`);
  await createTask(seed, `Theirs B ${seed.s}`);

  await uiLogin(page, seed.email, seed.password);
  await page.goto(viewsUrl(seed));

  await expect(page.getByTestId('view-body-table')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('table-row')).toHaveCount(3, { timeout: 15000 });

  await page.getByTestId('me-mode-toggle').click();
  // Me-mode keeps only the task assigned to the current user.
  await expect(page.getByTestId('table-row')).toHaveCount(1, { timeout: 15000 });
  await expect(page.getByText(`Mine ${seed.s}`, { exact: true })).toBeVisible();

  await seed.api.dispose();
});

// ── (c) Bulk bar: select two rows → set status → both reflect the change ───────
test('bulk bar: select rows and set status applies to all selected', async ({ page }) => {
  const seed = await apiSetup();
  await createTask(seed, `Task one ${seed.s}`);
  await createTask(seed, `Task two ${seed.s}`);

  await uiLogin(page, seed.email, seed.password);
  await page.goto(viewsUrl(seed));

  await expect(page.getByTestId('view-body-table')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('table-row')).toHaveCount(2, { timeout: 15000 });

  // Select both rows.
  const selects = page.getByTestId('row-select');
  await selects.nth(0).click();
  await selects.nth(1).click();

  // Bulk bar appears and reports the count.
  await expect(page.getByTestId('bulk-bar')).toBeVisible();
  await expect(page.getByTestId('bulk-count')).toHaveText('2 selected');

  // Set status to "In Progress" for both.
  await page.getByTestId('bulk-set-status').selectOption('In Progress');

  // Success toast (partial-success-aware message: "N updated").
  await expect(page.getByText(/\d+ updated/)).toBeVisible({ timeout: 15000 });

  // After the action the surface refreshes; the status column shows the new value.
  await expect(page.getByTestId('view-body-table')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('table-row').filter({ hasText: 'In Progress' })).toHaveCount(2, { timeout: 15000 });

  await seed.api.dispose();
});

// ── (d) A custom-field column renders the task's stored value (not "—") ────────
test('table: a custom-field column renders the stored value', async ({ page }) => {
  const seed = await apiSetup();

  // A SPACE-scoped text custom field. Filter/sort/group already resolved custom
  // fields server-side, but the table cell used to render "—" because the
  // viewTasks projection never carried the values (the gap this test guards).
  const cfRes = await seed.api.post(`${API_BASE}/custom-fields`, {
    headers: { Authorization: `Bearer ${seed.token}` },
    data: { scopeType: 'SPACE', scopeId: seed.spaceId, type: 'text', name: `Owner ${seed.s}`, position: 0 },
  });
  const field = (await cfRes.json()).data;
  const fieldId: string = field.id ?? field.Id;

  // A task carrying a DISTINCTIVE alpha value — `seed.s` is all digits and also
  // appears in the row's title, so a numeric marker could false-match the title.
  const marker = `cfmark${seed.s.replace(/\D/g, '')}`;
  const taskId = await createTask(seed, `CF row ${seed.s}`);
  await seed.api.put(`${API_BASE}/tasks/${taskId}/fields/${fieldId}`, {
    headers: { Authorization: `Bearer ${seed.token}` },
    data: { value: marker },
  });

  // A table view whose columns include the custom field.
  const { createSavedView } = await gql<{ createSavedView: { id: string } }>(seed.api, seed.token, /* GraphQL */ `
    mutation Create($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }
  `, {
    input: {
      scopeType: 'SPACE', scopeId: seed.spaceId, type: 'table', name: `CF Table ${seed.s}`,
      isShared: true, isDefault: false,
      config: JSON.stringify({
        filter: { conjunction: 'AND', rules: [] }, sort: [],
        columns: [{ kind: 'builtin', key: 'title' }, { kind: 'custom', key: fieldId }],
      }),
    },
  });

  await uiLogin(page, seed.email, seed.password);
  await page.goto(`/views/SPACE/${seed.spaceId}?viewId=${createSavedView.id}`);

  // The task's row renders the custom value (the `cfmark…` marker lives only in
  // the custom-field cell — the column header is in <thead>, not a table-row).
  const row = page.getByTestId('table-row').filter({ hasText: `CF row ${seed.s}` });
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row).toContainText(marker);

  await seed.api.dispose();
});

// ── (e) Engine Board: an assigned task renders its assignee avatar ─────────────
test('engine board: an assigned task shows its assignee avatar', async ({ page }) => {
  const seed = await apiSetup();
  await createTask(seed, `Board task ${seed.s}`, { assignToMe: true });

  // A SPACE-scoped BOARD view (the UI's "New view" only makes list views).
  const { createSavedView } = await gql<{ createSavedView: { id: string } }>(seed.api, seed.token, /* GraphQL */ `
    mutation Create($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }
  `, {
    input: {
      scopeType: 'SPACE', scopeId: seed.spaceId, type: 'board', name: `Board ${seed.s}`,
      isShared: true, isDefault: false,
      config: JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] }),
    },
  });

  await uiLogin(page, seed.email, seed.password);
  await page.goto(`/views/SPACE/${seed.spaceId}?viewId=${createSavedView.id}`);

  // The engine board renders, with the task card and its assignee avatar stack.
  // Avatars come from the views projection's per-task assignees (the gap this
  // closes — assigneesByTaskId used to be empty). The stack's aria-label carries
  // the assignee name seeded in apiSetup ("Views <s>").
  await expect(page.getByTestId('view-body-board')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(`Board task ${seed.s}`, { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('list', { name: new RegExp(`Assignees:.*Views ${seed.s}`) }).first())
    .toBeVisible({ timeout: 15000 });

  await seed.api.dispose();
});

// ── (f) EVERYTHING scope: sidebar nav opens the workspace-wide views surface ───
test('EVERYTHING scope: sidebar nav opens the workspace-wide surface and lists tasks', async ({ page }) => {
  const seed = await apiSetup();
  await createTask(seed, `WS task ${seed.s}`);

  // A workspace-wide EVERYTHING view. The backend fails CLOSED without a
  // workspaceId (no node ACL), so this also exercises the UI threading it.
  await gql(seed.api, seed.token, /* GraphQL */ `
    mutation Create($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }
  `, {
    input: {
      scopeType: 'EVERYTHING', type: 'table', name: `Everything ${seed.s}`,
      isShared: true, isDefault: true,
      config: JSON.stringify({
        filter: { conjunction: 'AND', rules: [] }, sort: [],
        columns: [{ kind: 'builtin', key: 'title' }, { kind: 'builtin', key: 'status' }],
      }),
      workspaceId: seed.wsId,
    },
  });

  await uiLogin(page, seed.email, seed.password);

  // The new sidebar "Everything" entry routes to /views/EVERYTHING/{workspaceId}.
  const navEntry = page.getByTestId('everything-nav');
  await expect(navEntry).toBeVisible({ timeout: 15000 });
  await navEntry.click();
  await page.waitForURL(new RegExp(`/views/EVERYTHING/${seed.wsId}`, 'i'), { timeout: 15000 });

  // The surface loaded (getSavedViews threaded workspaceId — no BAD_REQUEST) and
  // the EVERYTHING view's task page lists the workspace-wide task.
  await expect(page.getByTestId('view-tab').filter({ hasText: `Everything ${seed.s}` })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('table-row').filter({ hasText: `WS task ${seed.s}` })).toBeVisible({ timeout: 15000 });

  await seed.api.dispose();
});
