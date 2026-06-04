import { test, expect, request as pwRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

/**
 * Phase 2 (Custom Fields) headline e2e.
 *
 * The required-blocks-Done / cascade / progress_auto LOGIC is proven by the
 * api integration suite (src/modules/customfields/__tests__/*). This spec
 * proves the browser surface: the FieldManager settings UI creates a field
 * end-to-end (UI -> action -> API -> DB -> revalidate -> row), and the pages
 * touched by the Phase 2 wiring still render.
 */

async function apiSetup() {
  const s = uniq();
  const email = `e2e-cf-${s}@projectflow.test`;
  const password = 'E2EPass123!';
  const api = await pwRequest.newContext();
  await api.post(`${API_BASE}/auth/register`, { data: { email, name: `CF ${s}`, password } });
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const { data: { token } } = await login.json();
  const ws = await (await api.post(`${API_BASE}/workspaces`, {
    headers: { Authorization: `Bearer ${token}` }, data: { name: `WS ${s}`, slug: `ws-${s}` },
  })).json();
  const space = await (await api.post(`${API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { workspaceId: ws.data.Id, name: `Space ${s}`, key: `CF${s.slice(-4)}`, type: 'KANBAN' },
  })).json();
  return { s, email, password, token, api, wsId: ws.data.Id, spaceId: space.data.Id };
}

async function uiLogin(page: any, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

test('FieldManager: create a custom field through the settings UI', async ({ page }) => {
  const { email, password, s, api } = await apiSetup();
  await uiLogin(page, email, password);

  // Activate the Space (sets the selection cookie the settings page reads).
  const spaceNode = page.getByTestId('space-node').filter({ hasText: `Space ${s}` }).first();
  await expect(spaceNode).toBeVisible({ timeout: 10000 });
  await spaceNode.click();

  // Open project settings and the Custom Fields tab.
  await page.goto('/project-settings');
  await page.getByRole('tab', { name: /custom fields/i }).click();

  // Create a field via the dialog.
  await page.getByRole('button', { name: /add (your first )?field/i }).first().click();
  await page.getByPlaceholder(/priority|field|customer/i).fill(`Severity ${s}`);
  await page.getByRole('button', { name: /create field/i }).click();

  // The new row appears.
  await expect(
    page.getByTestId('custom-field-row').filter({ hasText: `Severity ${s}` }),
  ).toBeVisible({ timeout: 10000 });

  await api.dispose();
});

test('Phase 2 wiring: board / backlog / roadmap still render', async ({ page }) => {
  const { email, password, s, api } = await apiSetup();
  await uiLogin(page, email, password);

  const spaceNode = page.getByTestId('space-node').filter({ hasText: `Space ${s}` }).first();
  await expect(spaceNode).toBeVisible({ timeout: 10000 });
  await spaceNode.click();

  for (const path of ['/board', '/backlog', '/roadmap']) {
    await page.goto(path);
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 15000 });
    // No Next.js error overlay / crash.
    await expect(page.getByText(/application error|unhandled runtime/i)).toHaveCount(0);
  }

  await api.dispose();
});
