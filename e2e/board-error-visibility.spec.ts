/**
 * Before this change, board mutations (addTask, reorder, delete) called
 * `await api(...)` without checking the response. A 403 from the freeze
 * guard left React Query thinking the mutation succeeded; the optimistic
 * card silently rolled back on the next refetch and the user got no
 * signal something went wrong.
 *
 * This spec drives the actual addTask UI on a frozen workspace and
 * confirms:
 *   1. The Sonner toast appears with the WORKSPACE_FROZEN message.
 *   2. The new card does NOT remain in the column after the refetch.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';
import sql from 'mssql';

const API_BASE = 'http://localhost:3001/api/v1';

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function grantSuperAdmin(email: string) {
  const conn = await sql.connect({
    server: 'localhost', port: 1433, user: 'sa', password: 'YourStrong@Passw0rd',
    database: process.env.DB_NAME ?? 'ProjectFlow', options: { trustServerCertificate: true, encrypt: false },
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

async function revokeSuperAdmin(email: string) {
  const conn = await sql.connect({
    server: 'localhost', port: 1433, user: 'sa', password: 'YourStrong@Passw0rd',
    database: process.env.DB_NAME ?? 'ProjectFlow', options: { trustServerCertificate: true, encrypt: false },
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
}

test('board addTask on a frozen workspace surfaces a toast AND does not leave a phantom card', async ({ page }) => {
  const suffix   = uniqSuffix();
  const email    = `board-fz-${suffix}@projectflow.test`;
  const password = 'BoardPass123!';
  const wsName   = `BFZ ${suffix}`;
  const wsSlug   = `bfz-${suffix}`;
  const projName = `BFZ Proj ${suffix}`;
  const projKey  = `BF${suffix.slice(-4).toUpperCase()}`;

  const apiCtx = await playwrightRequest.newContext();

  // Setup: register, get a token, create workspace + project via API.
  // Doing this through the API instead of the UI keeps the test focused
  // on the failure-visibility behavior we actually care about.
  await apiCtx.post(`${API_BASE}/auth/register`, {
    data: { email, name: `BFZ ${suffix}`, password },
  });
  const login = await apiCtx.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const token = (await login.json()).data.token;

  const ws = await apiCtx.post(`${API_BASE}/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
    data:    { name: wsName, slug: wsSlug },
  });
  const wsId = (await ws.json()).data.Id;

  const proj = await apiCtx.post(`${API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
    data:    { workspaceId: wsId, name: projName, key: projKey, type: 'KANBAN' },
  });
  expect(proj.status()).toBe(201);

  // Freeze the workspace via the admin route (requires super-admin).
  await grantSuperAdmin(email);
  const adminLogin = await apiCtx.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const adminToken = (await adminLogin.json()).data.token;
  const setFrozen = await apiCtx.post(`${API_BASE}/admin/workspaces/${wsId}/status`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data:    { status: 'FROZEN' },
  });
  expect(setFrozen.status()).toBe(200);

  // Drop super-admin so the freeze actually applies to the browser session.
  // (Super-admin has admin.workspaces.* and bypasses the freeze guard.)
  await revokeSuperAdmin(email);

  // Log in via the UI.
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });

  // Open the board for the project we just created.
  await page.goto('/board');
  await expect(page.getByRole('button', { name: /Create issue in/i }).first()).toBeVisible({ timeout: 10_000 });

  // Click the column's "Create issue" button → type a title → submit.
  const cardTitle = `Should fail ${suffix}`;
  await page.getByRole('button', { name: /Create issue in/i }).first().click();
  // The inline input has an aria-label matching "New issue title for …".
  await page.getByRole('textbox', { name: /New issue title for/i }).first().fill(cardTitle);
  await page.getByRole('button', { name: /^add$/i }).click();

  // 1. Toast appears — target the Sonner toaster specifically so we don't
  //    collide with any in-page error banners that mention "frozen".
  await expect(
    page.locator('[data-sonner-toaster] [data-title]', { hasText: 'Workspace is frozen' }),
  ).toBeVisible({ timeout: 5_000 });

  // 2. No phantom card. The onSettled-invalidate refetches tasks; the
  //    freeze 403'd so there's no card to render. Wait briefly for the
  //    refetch and assert.
  await expect(page.getByText(cardTitle)).not.toBeVisible({ timeout: 5_000 });

  // Cleanup.
  await grantSuperAdmin(email);
  const cleanupLogin = await apiCtx.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const cleanupToken = (await cleanupLogin.json()).data.token;
  await apiCtx.delete(`${API_BASE}/workspaces/${wsId}`, {
    headers: { Authorization: `Bearer ${cleanupToken}` },
  });
  await apiCtx.dispose();
});
