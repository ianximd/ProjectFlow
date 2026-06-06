/**
 * Verifies that the new IDEA and TESTING workflow categories light up
 * end-to-end: dropdown picker → POST /workflows/.../statuses → board
 * renders the new column with the right category accent.
 *
 * Why a full E2E instead of a unit test: the change spans the type
 * union, the workflow editor CATEGORY_META, and the board Column
 * accent map. Each one in isolation could be correct while the
 * integration silently regresses (e.g. the API accepts the value but
 * the board falls back to TODO's grey accent because the accent map
 * was missed). Driving the actual UI proves all three layers agree.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

test('IDEA and TESTING categories show in the workflow editor and render on the board', async ({ page }) => {
  const suffix   = uniqSuffix();
  const email    = `bcat-${suffix}@projectflow.test`;
  const password = 'BCatPass123!';

  // Setup via API — auth + workspace + project (gets a default 3-column workflow).
  const apiCtx = await playwrightRequest.newContext();
  await apiCtx.post(`${API_BASE}/auth/register`, {
    data: { email, name: `BCat ${suffix}`, password },
  });
  const login = await apiCtx.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const token = (await login.json()).data.token;

  const ws = await apiCtx.post(`${API_BASE}/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
    data:    { name: `BCat WS ${suffix}`, slug: `bcat-${suffix}` },
  });
  const wsId = (await ws.json()).data.Id;

  await apiCtx.post(`${API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
    data:    { workspaceId: wsId, name: `BCat Proj ${suffix}`, key: `BC${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  });

  // UI login.
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });

  // Workflow editor: a fresh project has no workflow yet. Create the default
  // workflow first (it seeds Ideas/To Do/In Progress/Testing/Done), then add
  // a NEW IDEA status with a non-colliding name on top. The default already
  // seeds an "Ideas" status, so re-adding "Ideas" would 409 on the unique
  // (workflow, name) key, leave the modal open, and the open modal would make
  // the sidebar inert — the cause of the long-standing "Board link" timeout.
  //
  // NB: nav via sidebar link, NOT page.goto — the in-memory access
  // token (Zustand, not persisted) survives SPA nav but a hard reload
  // drops it, and AuthBootstrap's silent-refresh is flaky in dev.
  await page.getByRole('link', { name: /^workflows$/i }).first().click();
  await page.waitForURL(/\/workflows$/);
  await page.getByRole('button', { name: /create workflow/i }).click();
  await expect(page.getByRole('button', { name: /add status/i })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /add status/i }).first().click();

  // Dialog is now open — scope all further locators to it so we don't
  // collide with the outer "Add status" button or other page chrome.
  const dialog = page.getByRole('dialog');
  await dialog.locator('#st-name').fill('Discovery');

  // Category select shows 5 options now.
  await dialog.locator('#st-cat').click();
  await expect(page.getByRole('option', { name: /^idea$/i })).toBeVisible();
  await expect(page.getByRole('option', { name: /^testing$/i })).toBeVisible();
  // Pick IDEA for this new status.
  await page.getByRole('option', { name: /^idea$/i }).click();

  await dialog.getByRole('button', { name: /add status/i }).click();

  // The new "Discovery" status appears under the IDEA section in the editor.
  await expect(page.getByText('Discovery', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Board: the new Idea column shows up with the amber accent.
  await page.getByRole('link', { name: /^board$/i }).first().click();
  await page.waitForURL(/\/board$/);

  // usp_Workflow_AddStatus appends new statuses to MAX(Position)+1, so the
  // Discovery column lands after Done. Assert DOM presence (toHaveCount), not
  // viewport visibility — what we care about is "Discovery column rendered".
  const discoveryColumn = page
    .locator('[role="listitem"]')
    .filter({ has: page.locator('#col-Discovery') });
  await expect(discoveryColumn).toHaveCount(1, { timeout: 10_000 });
  // The new Idea column shows the amber accent stripe. Without the
  // CATEGORY_ACCENT update the column would silently fall back to TODO grey —
  // that's the regression we want to catch. Scope to this column: the default
  // template already seeds an "Ideas" (IDEA) column, so a board-wide
  // .bg-amber-400 count would be 2.
  await expect(discoveryColumn.locator('.bg-amber-400')).toHaveCount(1, { timeout: 5_000 });

  // Cleanup.
  await apiCtx.delete(`${API_BASE}/workspaces/${wsId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await apiCtx.dispose();
});
