/**
 * Phase 2.C E2E skeleton — single happy-path flow that proves:
 *   - the auth UI works end-to-end (register API → login UI → app shell)
 *   - the workspace creation dialog works
 *   - the project creation dialog works
 *
 * Deliberately skipped (future E2E iterations):
 *   - Task creation on the board (column UI is rich; not yet stabilised
 *     with test selectors).
 *   - Drag-and-drop (@dnd-kit needs synthetic mouse events that are
 *     famously flaky in Playwright; do this once we have a stable
 *     pattern, not as part of the skeleton).
 *
 * Cleanup at end via the soft-delete API so the dev DB doesn't fill with
 * leftover E2E data over time.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

// Each spec run uses a unique email + workspace so concurrent local dev
// + CI runs can't collide on Users.Email or Workspaces.Slug uniqueness.
function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

test('register → login → create workspace → create project', async ({ page, browserName }) => {
  const suffix     = uniqSuffix();
  const email      = `e2e-${suffix}@projectflow.test`;
  const password   = 'E2EPass123!';
  const wsName     = `E2E WS ${suffix}`;
  const wsSlug     = `e2e-ws-${suffix}`;
  const projName   = `E2E Project ${suffix}`;
  const projKey    = `E2E${suffix.slice(-4).toUpperCase()}`;

  // ── 1. Register via API ─────────────────────────────────────────────────
  // Skipping the register UI keeps the test focused on read-after-write
  // flows. The auth.routes integration suite already covers the register
  // form's contract.
  const apiCtx = await playwrightRequest.newContext();
  const reg    = await apiCtx.post(`${API_BASE}/auth/register`, {
    data: { email, name: `E2E User ${suffix}`, password },
  });
  expect(reg.status(), 'register API responded with 201').toBe(201);

  // ── 2. Login via UI ─────────────────────────────────────────────────────
  await page.goto('/login');
  await expect(page).toHaveTitle(/.+/); // anything non-empty
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // ── 3. Land in the app shell ────────────────────────────────────────────
  // Login redirects to /board (or first available app page). Wait for any
  // app-shell URL — being permissive here means a redirect change in the
  // app doesn't break the test.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

  // ── 4. Create a workspace via the dialog ────────────────────────────────
  // The in-memory access token lives in Zustand and is intentionally
  // NOT persisted to localStorage (XSS hardening — see useStore.ts).
  // SPA-internal navigation (clicking a link) preserves the token; a
  // hard reload (page.goto) loses it and forces AuthBootstrap to silent-
  // refresh via /auth/refresh + the httpOnly cookie. The refresh path
  // appears flakier in dev (cookie forwarding through next.config
  // rewrites), so we navigate via the sidebar link to stay in-process.
  await page.getByRole('link', { name: /workspaces/i }).first().click();
  await page.waitForURL(/\/workspaces$/);
  await page.getByRole('button', { name: /new workspace/i }).click();

  await page.locator('#ws-name').fill(wsName);
  // Slug auto-fills from the name; clear and set explicitly so we know
  // the value is unique even if `slugify` changes its rules.
  await page.locator('#ws-slug').fill(wsSlug);

  await page.getByRole('button', { name: /create workspace/i }).click();

  // The dialog closes and the new workspace appears in the grid.
  await expect(page.getByText(wsName, { exact: true })).toBeVisible({ timeout: 10_000 });

  // ── 5. Create a project under that workspace ────────────────────────────
  // SPA nav again, same reason as above.
  await page.getByRole('link', { name: /^projects$/i }).first().click();
  await page.waitForURL(/\/projects$/);

  // The project list page filters by workspace via a select — selecting
  // the just-created workspace ensures the new project lands under it.
  // Selectors here are looser because the projects page uses Radix
  // SelectTriggers; the trigger's accessible name is the placeholder.
  await page.getByRole('button', { name: /new project/i }).first().click();

  await page.locator('#proj-name').fill(projName);
  await page.locator('#proj-key').fill(projKey);

  // The project dialog likely needs a workspace selection — find any
  // visible workspace selector inside the dialog and pick our new ws.
  // If the dialog already pre-selects the active workspace, this is a
  // no-op. We don't fail the test on the absence of the selector since
  // its presence depends on URL-driven preselection logic.
  const wsSelector = page.getByRole('combobox', { name: /workspace/i });
  if (await wsSelector.first().isVisible().catch(() => false)) {
    await wsSelector.first().click();
    await page.getByRole('option', { name: wsName }).click();
  }

  await page.getByRole('button', { name: /^create project$/i }).click();

  await expect(page.getByText(projName, { exact: true })).toBeVisible({ timeout: 10_000 });

  // ── 6. Cleanup — soft-delete the workspace via API ──────────────────────
  // Login again via API to get a token (the page session uses cookies +
  // an in-memory access token we can't reach from the test harness).
  const loginRes = await apiCtx.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(loginRes.status()).toBe(200);
  const { data: { token } } = await loginRes.json();

  const wsList = await apiCtx.get(`${API_BASE}/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const workspaces = (await wsList.json()).data as { Id: string; Name: string }[];
  const created    = workspaces.find((w) => w.Name === wsName);
  expect(created, 'created workspace must be findable for cleanup').toBeDefined();

  const del = await apiCtx.delete(`${API_BASE}/workspaces/${created!.Id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([204, 404]).toContain(del.status());

  await apiCtx.dispose();

  // browserName is referenced so TypeScript doesn't complain about the
  // unused fixture destructure on platforms where it'd otherwise warn.
  expect(browserName).toBeTruthy();
});
