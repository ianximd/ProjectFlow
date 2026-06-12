import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * Phase 8d (Workload & Box Views) e2e — Task 11.
 *
 * Two scenarios:
 *   (a) workload view: seeds 2 tasks (2 × 8 h estimate) assigned to the owner
 *       within a 5-day range whose capacity is only 1 h/day (5 h total). The
 *       owner's workload row must carry data-status="over" and show the
 *       over-capacity badge.
 *   (b) box view: the same tasks produce an assignee lane with data-count ≥ 1.
 *
 * Mirrors views.spec.ts: gql() helper, apiSetup(), uiLogin(), API_BASE/GRAPHQL
 * constants. The `config` field of createSavedView is passed as a JSON string
 * (confirmed from views.spec.ts line 92 — JSON.stringify(…)).
 */

const API_BASE = 'http://localhost:3001/api/v1';
const GRAPHQL   = `${API_BASE}/graphql`;
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
}

async function gql<T = any>(
  api: APIRequestContext,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await api.post(GRAPHQL, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { query, variables },
  });
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

async function apiSetup(): Promise<Seed> {
  const s = uniq();
  const email    = `e2e-wbv-${s}@projectflow.test`;
  const password = 'E2EPass123!';
  const api      = await pwRequest.newContext();

  await api.post(`${API_BASE}/auth/register`, {
    data: { email, name: `WBV ${s}`, password },
  });
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const { data: { token, user } } = await login.json();
  const userId = user?.Id ?? user?.id;

  const ws = await (await api.post(`${API_BASE}/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `WS ${s}`, slug: `ws-${s}` },
  })).json();
  const wsId = ws.data.Id;

  const space = await (await api.post(`${API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { workspaceId: wsId, name: `Space ${s}`, key: `WB${s.slice(-4)}`, type: 'KANBAN' },
  })).json();
  const spaceId = space.data.Id;

  const list = await (await api.post(`${API_BASE}/lists`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { workspaceId: wsId, spaceId, folderId: null, name: `List ${s}`, position: 0 },
  })).json();
  const listId = list.data.Id;

  return { s, email, password, token, api, userId, wsId, spaceId, listId };
}

async function uiLogin(page: any, seed: Seed) {
  await page.goto('/login');
  await page.locator('#email').fill(seed.email);
  await page.locator('#password').fill(seed.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

/**
 * Seed a task assigned to the owner with a time estimate.
 * dueDate must be a full ISO datetime string with UTC offset (zod .datetime({offset:true})).
 * Estimate is set via PUT /worklogs/tasks/:taskId/estimate.
 */
async function seedOverloadedTask(seed: Seed, title: string): Promise<string> {
  const t = await (await seed.api.post(`${API_BASE}/tasks`, {
    headers: { Authorization: `Bearer ${seed.token}` },
    data: {
      workspaceId: seed.wsId,
      listId: seed.listId,
      title,
      type: 'TASK',
      priority: 'HIGH',
      storyPoints: 8,
      // dueDate inside the 2026-06-01 → 2026-06-05 range used in the test URL
      dueDate: '2026-06-03T00:00:00.000Z',
    },
  })).json();
  const taskId: string = t.data?.Id ?? t.data?.id;

  // Assign to the logged-in owner.
  await seed.api.put(`${API_BASE}/tasks/${taskId}/assignees`, {
    headers: { Authorization: `Bearer ${seed.token}` },
    data: { userIds: [seed.userId] },
  });

  // Set the task-level time estimate to 8 h (28 800 s).
  // This is what getViewCapacity sums against capacityPerDaySeconds.
  await seed.api.put(`${API_BASE}/worklogs/tasks/${taskId}/estimate`, {
    headers: { Authorization: `Bearer ${seed.token}` },
    data: { estimateSeconds: 28800 },
  });

  return taskId;
}

// ── (a) Workload flags over-capacity assignee ──────────────────────────────────
test('workload view: over-capacity assignee row carries data-status=over and badge', async ({ page }) => {
  const seed = await apiSetup();

  // 2 tasks × 8 h estimate = 16 h assigned.
  // Range 2026-06-01 → 2026-06-05 (5 days) × 1 h/day capacity = 5 h total → 16h ≫ 5h → over.
  await seedOverloadedTask(seed, `Workload A ${seed.s}`);
  await seedOverloadedTask(seed, `Workload B ${seed.s}`);

  // Create a SPACE-scoped workload view with a tiny capacity (1 h/day).
  const { createSavedView } = await gql<{ createSavedView: { id: string } }>(
    seed.api, seed.token,
    /* GraphQL */ `mutation Create($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }`,
    {
      input: {
        scopeType: 'SPACE',
        scopeId: seed.spaceId,
        type: 'workload',
        name: `Workload ${seed.s}`,
        isShared: true,
        isDefault: false,
        config: JSON.stringify({
          filter: { conjunction: 'AND', rules: [] },
          sort: [],
          capacityMetric: 'time',
          capacityPerDaySeconds: 3600, // 1 h/day → 5 h over 5-day range
        }),
      },
    },
  );
  const workloadViewId = createSavedView.id;

  await uiLogin(page, seed);

  // Navigate to the workload view with the 5-day range.
  await page.goto(`/views/SPACE/${seed.spaceId}?viewId=${workloadViewId}&from=2026-06-01&to=2026-06-05`);

  // The workload body is SSR'd, but Playwright's auto-retry handles any hydration gap.
  await expect(page.getByTestId('view-body-workload')).toBeVisible({ timeout: 20000 });

  const overRow = page.getByTestId(`workload-row-${seed.userId}`);
  await expect(overRow).toBeVisible({ timeout: 15000 });
  await expect(overRow).toHaveAttribute('data-status', 'over');
  await expect(overRow.getByTestId('over-capacity-badge')).toBeVisible();

  await seed.api.dispose();
});

// ── (b) Box view groups tasks by assignee ─────────────────────────────────────
test('box view: assigned tasks appear in the owner assignee lane', async ({ page }) => {
  const seed = await apiSetup();

  // Seed two tasks assigned to the owner — both should land in their lane.
  await seedOverloadedTask(seed, `Box A ${seed.s}`);
  await seedOverloadedTask(seed, `Box B ${seed.s}`);

  // Create a SPACE-scoped box view.
  const { createSavedView } = await gql<{ createSavedView: { id: string } }>(
    seed.api, seed.token,
    /* GraphQL */ `mutation Create($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }`,
    {
      input: {
        scopeType: 'SPACE',
        scopeId: seed.spaceId,
        type: 'box',
        name: `Box ${seed.s}`,
        isShared: true,
        isDefault: false,
        config: JSON.stringify({
          filter: { conjunction: 'AND', rules: [] },
          sort: [],
        }),
      },
    },
  );
  const boxViewId = createSavedView.id;

  await uiLogin(page, seed);

  await page.goto(`/views/SPACE/${seed.spaceId}?viewId=${boxViewId}`);

  // The box view renders client-side after hydration — toBeVisible() auto-waits.
  await expect(page.getByTestId('view-body-box')).toBeVisible({ timeout: 20000 });

  const lane = page.getByTestId(`box-lane-${seed.userId}`);
  await expect(lane).toBeVisible({ timeout: 15000 });
  // data-count must be a positive integer (both tasks end up in the owner's lane).
  await expect(lane).toHaveAttribute('data-count', /[1-9][0-9]*/);

  await seed.api.dispose();
});
