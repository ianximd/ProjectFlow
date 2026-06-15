/**
 * E2E: Public Share Links (Phase 10c). Proves the BUILD_PLAN acceptance (§6.5):
 *   "a public share link exposes ONLY the shared object, read-only, no auth —
 *    with no way to reach siblings/parent."
 *
 * One authed owner seeds (REST) a workspace → project (Space) → list → ONE task,
 * then drives the browser:
 *   1. opens the task in the board drawer, opens the Share modal, creates a public
 *      link, and reads the public `/share/<token>` URL from the modal,
 *   2. opens that URL in a FRESH (UNauthenticated, no-cookie) browser context and
 *      asserts: the task title + description render, a "Read-only" badge is shown,
 *      and there is NO nav / NO write affordance / NO leak of the list or
 *      workspace id (the projection is navigation- and write-stripped),
 *   3. revokes the link from the modal → the anonymous URL now 404s.
 *
 * Modeled on e2e/app-toggles.spec.ts + e2e/forms.spec.ts (same register/login +
 * workspace→project→list→task seeding envelopes, the `/board` → click-card →
 * dialog drawer-open idiom, and the fresh-context anonymous public render).
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (ProjectFlow_Test) — see
 * e2e/README.md. Run by the controller (booting the dev servers needs the safe DB
 * env); do not run ad hoc against any other target.
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

/** Open the seeded task's board drawer (retry the open-click to absorb hydration). */
async function openTaskDrawer(page: Page, title: string) {
  await page.goto('/board');
  await expect(page.getByRole('region', { name: /kanban board/i })).toBeVisible({ timeout: 20_000 });
  const drawer = page.getByRole('dialog').filter({ hasText: title });
  await expect(async () => {
    const card = page.getByText(title, { exact: false }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();
    await expect(drawer).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  return drawer;
}

test.describe('Phase 10c — public share links', () => {
  test('owner shares a task; an anonymous visitor sees read-only content with no nav; revoke 404s', async ({ browser }) => {
    const suffix      = uniqSuffix();
    const password    = 'E2EPass123!';
    const email       = `share-${suffix}@projectflow.test`;
    const title       = `Shared task ${suffix}`;
    const description = `Secret body ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register + login (API) ─────────────────────────────────────────────
    expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name: `Share ${suffix}`, password } })).status(), 'register').toBe(201);
    const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(login.status(), 'login').toBe(200);
    const { data: { token } } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 2. Seed workspace → project (Space) → list → task ─────────────────────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, { headers, data: { name: `Share WS ${suffix}`, slug: `share-ws-${suffix}` } })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, { headers, data: { workspaceId, name: `Share P ${suffix}`, key: `SH${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' } })).json()).data;
    const spaceId: string = project.Id ?? project.id;

    const list = (await (await api.post(`${API_BASE}/lists`, { headers, data: { workspaceId, spaceId, folderId: null, name: 'Default', position: 0 } })).json()).data;
    const listId: string = list.id ?? list.Id;
    expect(listId, 'listId').toBeTruthy();

    const taskRes = await api.post(`${API_BASE}/tasks`, { headers, data: { workspaceId, listId, title, description } });
    expect(taskRes.status(), 'create task').toBe(201);

    // ── 3. UI: open the task drawer, open the Share modal, create a public link ─
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, email, password);
    const drawer = await openTaskDrawer(page, title);

    await drawer.getByRole('button', { name: /share/i }).click();
    // Both the drawer and the share modal are role=dialog — disambiguate by the
    // modal's unique "Create public link" control (app convention: filter hasText).
    const modal = page.getByRole('dialog').filter({ hasText: /create public link/i });
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await modal.getByRole('button', { name: /create public link/i }).click();

    const urlInput = modal.locator('input[readonly]').first();
    await expect(urlInput).toBeVisible({ timeout: 10_000 });
    const shareUrl = await urlInput.inputValue();
    expect(shareUrl, 'public share URL shape').toMatch(/\/share\/[A-Za-z0-9_-]{64}$/);
    const sharePath = new URL(shareUrl).pathname; // /share/<token>

    // ── 4. Anonymous: open the public link in a fresh context (no cookies) ─────
    const anon     = await browser.newContext();
    const anonPage = await anon.newPage();
    const resp     = await anonPage.goto(sharePath);
    expect(resp?.status(), 'public render status').toBe(200);

    await expect(anonPage.getByRole('article')).toBeVisible({ timeout: 15_000 });
    await expect(anonPage.getByText(/read-only/i)).toBeVisible();
    await expect(anonPage.getByRole('heading', { name: title })).toBeVisible();
    await expect(anonPage.getByText(description)).toBeVisible();

    // Isolation: NO navigation up the tree, NO write affordances, NO id leak.
    await expect(anonPage.locator('nav')).toHaveCount(0);
    await expect(anonPage.getByRole('button', { name: /edit|delete|save|assign/i })).toHaveCount(0);
    await expect(anonPage.locator('body')).not.toContainText(listId);
    await expect(anonPage.locator('body')).not.toContainText(workspaceId);

    // ── 5. Revoke (UI) → the anonymous link 404s ──────────────────────────────
    await page.bringToFront();
    await modal.getByRole('button', { name: /revoke/i }).first().click();
    // The modal refetches after revoke; the link row (its readonly URL) disappears.
    await expect(modal.locator('input[readonly]')).toHaveCount(0, { timeout: 10_000 });

    // The authoritative security boundary is the membership-free public resolver
    // /public/share/:token — hit it directly (fresh context, no auth header) so the
    // assertion isn't confounded by Next's route cache. A revoked token must 404.
    const shareToken = sharePath.split('/').pop()!;
    const revoked    = await api.get(`${API_BASE}/public/share/${shareToken}`);
    expect(revoked.status(), 'revoked token 404s at the public resolver').toBe(404);

    // ── Cleanup ───────────────────────────────────────────────────────────────
    await anon.close();
    await ctx.close();
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404]).toContain(wsDel.status());
    await api.dispose();
  });
});
