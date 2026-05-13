/**
 * Browser check for the WORKSPACE_FROZEN toast — proves notifyApiError
 * actually surfaces a user-readable message instead of silently failing
 * the project-create dialog.
 *
 * Flow: register, create a workspace, freeze it via the admin API,
 * attempt to create a project from the projects page UI, expect the
 * Sonner toast to appear with "Workspace is frozen".
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';
import sql from 'mssql';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function grantSuperAdmin(email: string) {
  const conn = await sql.connect({
    server:   'localhost',
    port:     1433,
    user:     'sa',
    password: 'YourStrong@Passw0rd',
    database: 'ProjectFlow',
    options:  { trustServerCertificate: true, encrypt: false },
  });
  try {
    const r = await conn.request().input('Email', email)
      .query('SELECT Id FROM dbo.Users WHERE Email = @Email');
    const userId = r.recordset[0]?.Id;
    if (!userId) throw new Error(`No user for ${email}`);
    await conn.request().input('UserId', userId).input('RoleSlug', 'super-admin')
      .execute('usp_UserRole_AssignBySlug');
  } finally {
    await conn.close();
  }
}

test('frozen workspace → project-create attempt shows the WORKSPACE_FROZEN toast', async ({ page }) => {
  const suffix   = uniqSuffix();
  const email    = `ftoast-${suffix}@projectflow.test`;
  const password = 'FreezePass123!';
  const wsName   = `FT ${suffix}`;
  const wsSlug   = `ft-${suffix}`;

  const apiCtx = await playwrightRequest.newContext();

  await apiCtx.post(`${API_BASE}/auth/register`, {
    data: { email, name: `FT ${suffix}`, password },
  });

  // UI login
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });

  // Create workspace via UI
  await page.getByRole('link', { name: /workspaces/i }).first().click();
  await page.waitForURL(/\/workspaces$/);
  await page.getByRole('button', { name: /new workspace/i }).click();
  await page.locator('#ws-name').fill(wsName);
  await page.locator('#ws-slug').fill(wsSlug);
  await page.getByRole('button', { name: /create workspace/i }).click();
  await expect(page.getByText(wsName, { exact: true })).toBeVisible({ timeout: 10_000 });

  // Freeze it via admin API (granting super-admin first)
  await grantSuperAdmin(email);
  const login = await apiCtx.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const { data: { token } } = await login.json();
  const wsList = await apiCtx.get(`${API_BASE}/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const wsId = (await wsList.json()).data.find((w: any) => w.Name === wsName).Id;
  const setFrozen = await apiCtx.post(`${API_BASE}/admin/workspaces/${wsId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
    data:    { status: 'FROZEN' },
  });
  expect(setFrozen.status()).toBe(200);

  // Go to the projects page. The current user is super-admin so the freeze
  // guard would bypass — drop the super-admin role first so the freeze
  // actually applies to this browser session's writes.
  const conn = await sql.connect({
    server: 'localhost', port: 1433, user: 'sa', password: 'YourStrong@Passw0rd',
    database: 'ProjectFlow', options: { trustServerCertificate: true, encrypt: false },
  });
  try {
    await conn.request().input('Email', email).query(`
      DELETE ur
      FROM   dbo.UserRoles ur
      JOIN   dbo.Roles r ON r.Id = ur.RoleId
      JOIN   dbo.Users u ON u.Id = ur.UserId
      WHERE  u.Email = @Email AND r.Slug = 'super-admin' AND ur.WorkspaceId IS NULL
    `);
  } finally {
    await conn.close();
  }

  // Force a fresh token via the UI silent refresh (or just re-login through UI).
  // Simpler: hop to projects page; the existing token in Zustand still has the
  // role baked in (JWTs are stateless) — but the API's RBAC is workspace-scoped
  // and reads the DB on each request, so the freeze guard fires the moment we
  // attempt a workspace-scoped write. No new login needed.

  await page.getByRole('link', { name: /^projects$/i }).first().click();
  await page.waitForURL(/\/projects$/);

  // Open create dialog + fill it in
  await page.getByRole('button', { name: /new project/i }).first().click();
  await page.locator('#proj-name').fill('Should Be Blocked');
  await page.locator('#proj-key').fill(`FT${suffix.slice(-4).toUpperCase()}`);
  await page.getByRole('button', { name: /^create project$/i }).click();

  // The Sonner toast appears with our friendly message. Target it
  // specifically — there's also an in-page error banner that surfaces the
  // raw API message, which would match a plain getByText.
  await expect(
    page.locator('[data-sonner-toaster] [data-title]', { hasText: 'Workspace is frozen' }),
  ).toBeVisible({ timeout: 5_000 });

  // Cleanup — re-grant super-admin so we can delete the workspace.
  await grantSuperAdmin(email);
  const login2 = await apiCtx.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const token2 = (await login2.json()).data.token;
  await apiCtx.delete(`${API_BASE}/workspaces/${wsId}`, {
    headers: { Authorization: `Bearer ${token2}` },
  });
  await apiCtx.dispose();
});
