import { test, expect, request as pwRequest } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

test('create Space tree (folder + list) in sidebar, create a task, persist on reload', async ({ page }) => {
  const s = uniq();
  const email = `e2e-h-${s}@projectflow.test`;
  const password = 'E2EPass123!';

  const api = await pwRequest.newContext();
  await api.post(`${API_BASE}/auth/register`, { data: { email, name: `H ${s}`, password } });
  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  const { data: { token } } = await login.json();
  const ws = await (await api.post(`${API_BASE}/workspaces`, { headers: { Authorization: `Bearer ${token}` }, data: { name: `WS ${s}`, slug: `ws-${s}` } })).json();
  await api.post(`${API_BASE}/projects`, { headers: { Authorization: `Bearer ${token}` }, data: { workspaceId: ws.data.Id, name: `Space ${s}`, key: `SP${s.slice(-4)}`, type: 'KANBAN' } });

  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });

  // Create a Folder under the Space.
  const spaceNode = page.getByTestId('space-node').filter({ hasText: `Space ${s}` }).first();
  await spaceNode.hover();
  await spaceNode.getByTestId('folder-add').click();
  await page.getByTestId('node-name-input').fill(`Folder ${s}`);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('folder-node').filter({ hasText: `Folder ${s}` })).toBeVisible({ timeout: 10000 });

  // Create a List under the Folder.
  const folderNode = page.getByTestId('folder-node').filter({ hasText: `Folder ${s}` }).first();
  await folderNode.hover();
  await folderNode.getByTestId('list-add').click();
  await page.getByTestId('node-name-input').fill(`List ${s}`);
  await page.keyboard.press('Enter');
  const listNode = page.getByTestId('list-node').filter({ hasText: `List ${s}` });
  await expect(listNode).toBeVisible({ timeout: 10000 });

  // Open the List, create a task.
  await listNode.click();
  await page.waitForURL(/\/lists\//);
  await page.getByTestId('list-task-input').fill(`Task ${s}`);
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Task ${s}`, { exact: true })).toBeVisible({ timeout: 10000 });

  // Reload: tree + task persist.
  await page.reload();
  await expect(page.getByTestId('list-node').filter({ hasText: `List ${s}` })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(`Task ${s}`, { exact: true })).toBeVisible({ timeout: 10000 });

  await api.dispose();
});
