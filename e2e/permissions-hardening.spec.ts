/**
 * E2E: Permissions Hardening (Phase 10b) — §5.4 headline flow.
 * An authed owner seeds (over REST) a workspace → space → two sibling lists (A, B)
 * and a separate grantee user (a NON-member of the workspace), then drives the UI:
 *   1. opens workspace settings and creates a workspace CUSTOM ROLE via the
 *      CustomRoleManager (exercises the role-manager UI + role.manage REST),
 *   2. opens List A's settings and grants the grantee EDIT via the
 *      ObjectPermissionEditor add-grant form (exercises the FULL-gated editor),
 *   3. proves the grant is LIST-A-SPECIFIC over the real API: List A's grant list
 *      includes grantee@EDIT, List B's does NOT — "edit here, not the sibling".
 * (The resolver's most-specific-wins-over-the-floor behavior is exhaustively
 * proven by the §5.5 permission-matrix integration test; this e2e proves the two
 * new UI surfaces work end-to-end and that a per-object grant is scoped to one list.)
 *
 * DB SAFETY: run ONLY with the local Docker test DB env (ProjectFlow_Test).
 * Run by the controller (booting the dev servers needs the safe DB env).
 */

import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

test.describe('Phase 10b — permissions hardening', () => {
  test('create a custom role + grant a user EDIT on one List via the UI (scoped to that list, not its sibling)', async ({ browser }) => {
    const suffix   = uniqSuffix();
    const password = 'E2EPass123!';
    const email    = `perm-owner-${suffix}@projectflow.test`;
    const granteeEmail = `perm-grantee-${suffix}@projectflow.test`;
    const granteeName  = `Grantee ${suffix}`;

    const api = await playwrightRequest.newContext();

    // ── 1. Register owner + grantee; login owner ──────────────────────────────
    expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name: `Perm Owner ${suffix}`, password } })).status(), 'register owner').toBe(201);
    const granteeReg = await api.post(`${API_BASE}/auth/register`, { data: { email: granteeEmail, name: granteeName, password } });
    expect(granteeReg.status(), 'register grantee').toBe(201);
    const granteeId: string = (await granteeReg.json()).data.Id;
    expect(granteeId, 'granteeId').toBeTruthy();

    const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
    expect(login.status(), 'login owner').toBe(200);
    const { data: { token } } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 2. workspace → space → two sibling lists (grantee is NOT added) ───────
    const ws = (await (await api.post(`${API_BASE}/workspaces`, { headers, data: { name: `Perm WS ${suffix}`, slug: `perm-ws-${suffix}` } })).json()).data;
    const workspaceId: string = ws.Id ?? ws.id;
    expect(workspaceId, 'workspaceId').toBeTruthy();

    const project = (await (await api.post(`${API_BASE}/projects`, {
      headers, data: { workspaceId, name: `Perm Space ${suffix}`, key: `PM${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
    })).json()).data;
    const spaceId: string = project.Id ?? project.id;

    const listA = (await (await api.post(`${API_BASE}/lists`, { headers, data: { workspaceId, spaceId, folderId: null, name: 'List A', position: 0 } })).json()).data;
    const listB = (await (await api.post(`${API_BASE}/lists`, { headers, data: { workspaceId, spaceId, folderId: null, name: 'List B', position: 1 } })).json()).data;
    const listAId: string = listA.id ?? listA.Id;
    const listBId: string = listB.id ?? listB.Id;
    expect(listAId && listBId, 'list ids').toBeTruthy();

    // ── 3. Browser: create a custom role in workspace settings ────────────────
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, email, password);

    await page.goto(`/workspaces/${workspaceId}/settings`);
    const roleNameInput = page.getByPlaceholder(/QA Reviewer/i);
    await expect(roleNameInput).toBeVisible({ timeout: 20_000 });
    await roleNameInput.fill('Editor Role');
    await page.getByRole('button', { name: /create role/i }).click();
    await expect(page.getByText('Editor Role', { exact: false })).toBeVisible({ timeout: 15_000 });

    // ── 4. Grant the grantee EDIT on List A via the object-permission editor ──
    await page.goto(`/lists/${listAId}/settings`);
    await expect(page.getByText(/who has access/i)).toBeVisible({ timeout: 20_000 });
    const addInput = page.getByPlaceholder(/user id to grant/i);
    await expect(addInput).toBeVisible({ timeout: 10_000 });
    await addInput.fill(granteeId);
    // the add-form level <select> defaults VIEW; choose EDIT, then Add
    await page.locator('select').last().selectOption('EDIT');
    await page.getByRole('button', { name: /^add$/i }).click();
    // the grant row for the grantee appears (SubjectName resolved server-side)
    await expect(page.getByText(granteeName, { exact: false })).toBeVisible({ timeout: 15_000 });

    // ── 5. Prove the grant is LIST-A-SPECIFIC over the real API ───────────────
    const grantsA = (await (await api.get(`${API_BASE}/access/LIST/${listAId}/permissions`, { headers })).json()).data as any[];
    expect(grantsA.some((g) => g.subjectId === granteeId && g.level === 'EDIT' && g.inherited === false), 'grantee has direct EDIT on List A').toBe(true);

    const grantsB = (await (await api.get(`${API_BASE}/access/LIST/${listBId}/permissions`, { headers })).json()).data as any[];
    expect(grantsB.some((g) => g.subjectId === granteeId), 'grantee has NO grant on sibling List B').toBe(false);

    // ── 6. Cleanup ────────────────────────────────────────────────────────────
    await ctx.close();
    const wsDel = await api.delete(`${API_BASE}/workspaces/${workspaceId}`, { headers });
    expect([204, 404], 'workspace cleanup').toContain(wsDel.status());
    await api.dispose();
  });
});
