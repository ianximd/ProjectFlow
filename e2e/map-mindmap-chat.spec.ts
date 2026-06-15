import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * Phase 9f headline e2e — Map / Mind Map / Chat views (§9.5 acceptance).
 *
 * Mirrors views.spec.ts: data is seeded over the REST + GraphQL API
 * (register → login → workspace → project[=Space] → List → tasks), the three
 * SAVED VIEWS are created over GraphQL (the UI has no view-type picker), and the
 * browser authenticates through the real login UI. Each view is opened via the
 * `?viewId=` selector on /views/SPACE/{spaceId}.
 *
 *  - Map: the parent task carries a `location` value → a pin renders on the
 *    OpenStreetMap canvas; clicking it opens the task panel.
 *  - Mind Map: the parent node renders with an expandable child; collapse hides
 *    the child, expand restores it.
 *  - Chat: posting in the channel composer creates a real comment that appears.
 */

const API_BASE = 'http://localhost:3001/api/v1';
const GRAPHQL = `${API_BASE}/graphql`;
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

interface Seed {
  email: string;
  password: string;
  spaceId: string;
  mapViewId: string;
  mindMapViewId: string;
  chatViewId: string;
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

const CREATE_VIEW = /* GraphQL */ `
  mutation Create($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }
`;
const emptyConfig = JSON.stringify({ filter: { conjunction: 'AND', rules: [] }, sort: [] });

async function apiSetup(): Promise<Seed> {
  const s = uniq();
  const email = `e2e-mmc-${s}@projectflow.test`;
  const password = 'E2EPass123!';
  const api = await pwRequest.newContext();
  const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  await api.post(`${API_BASE}/auth/register`, { data: { email, name: `MMC ${s}`, password } });
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email, password } })).json();

  const wsId = (await (await api.post(`${API_BASE}/workspaces`, { ...auth(token), data: { name: `WS ${s}`, slug: `ws-${s}` } })).json()).data.Id;
  const spaceId = (await (await api.post(`${API_BASE}/projects`, {
    ...auth(token), data: { workspaceId: wsId, name: `Space ${s}`, key: `MM${s.slice(-4)}`, type: 'KANBAN' },
  })).json()).data.Id;
  const listId = (await (await api.post(`${API_BASE}/lists`, {
    ...auth(token), data: { workspaceId: wsId, spaceId, folderId: null, name: `List ${s}`, position: 0 },
  })).json()).data.Id;

  // SPACE-scoped 'location' custom field.
  const fieldId = (await (await api.post(`${API_BASE}/custom-fields`, {
    ...auth(token), data: { scopeType: 'SPACE', scopeId: spaceId, type: 'location', name: 'Office' },
  })).json()).data.id;

  // Parent task 'HQ' with a location value + a child 'Sub-A'.
  const hqId = (await (await api.post(`${API_BASE}/tasks`, {
    ...auth(token), data: { workspaceId: wsId, listId, title: 'HQ', type: 'TASK' },
  })).json()).data.Id;
  await api.put(`${API_BASE}/tasks/${hqId}/fields/${fieldId}`, {
    ...auth(token), data: { value: { lat: -6.2, lng: 106.8, label: 'Jakarta' } },
  });
  await api.post(`${API_BASE}/tasks`, {
    ...auth(token), data: { workspaceId: wsId, listId, title: 'Sub-A', type: 'TASK', parentTaskId: hqId },
  });

  const view = async (type: string): Promise<string> => (await gql<{ createSavedView: { id: string } }>(api, token, CREATE_VIEW, {
    input: { scopeType: 'SPACE', scopeId: spaceId, type, name: `${type} ${s}`, isShared: true, isDefault: false, config: emptyConfig },
  })).createSavedView.id;

  const mapViewId = await view('map');
  const mindMapViewId = await view('mindmap');
  const chatViewId = await view('chat');

  await api.dispose();
  return { email, password, spaceId, mapViewId, mindMapViewId, chatViewId };
}

async function uiLogin(page: any, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

test('Phase 9f — Map pin+panel, Mind Map expand/collapse, Chat post', async ({ page }) => {
  const seed = await apiSetup();
  await uiLogin(page, seed.email, seed.password);

  // ── Map: the located task renders a pin; clicking it opens the task panel.
  await page.goto(`/views/SPACE/${seed.spaceId}?viewId=${seed.mapViewId}`);
  await expect(page.getByTestId('view-body-map')).toBeVisible({ timeout: 15000 });
  const marker = page.locator('.leaflet-marker-icon').first();
  await expect(marker).toBeVisible({ timeout: 15000 });
  // The view-tab bar overlaps the marker's hit-point; dispatch the click directly
  // on the marker element so leaflet's click handler fires regardless of overlap.
  await marker.dispatchEvent('click');
  await expect(page.getByTestId('map-task-panel')).toBeVisible();
  await expect(page.getByTestId('map-task-panel')).toContainText('HQ');

  // ── Mind Map: the parent node renders with an expandable child.
  await page.goto(`/views/SPACE/${seed.spaceId}?viewId=${seed.mindMapViewId}`);
  await expect(page.getByTestId('view-body-mindmap')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('mindmap-node').filter({ hasText: 'HQ' })).toBeVisible({ timeout: 15000 });
  const toggle = page.getByTestId('mindmap-toggle').first();
  await toggle.click(); // collapse
  await expect(page.getByTestId('mindmap-node').filter({ hasText: 'Sub-A' })).toHaveCount(0);
  await toggle.click(); // expand
  await expect(page.getByTestId('mindmap-node').filter({ hasText: 'Sub-A' })).toBeVisible();

  // ── Chat: post a message; it appears in the stream (real comment).
  await page.goto(`/views/SPACE/${seed.spaceId}?viewId=${seed.chatViewId}`);
  const chat = page.getByTestId('view-body-chat');
  await expect(chat).toBeVisible({ timeout: 15000 });
  const composer = chat.getByPlaceholder(/add a comment/i);
  await expect(composer).toBeVisible({ timeout: 15000 });
  await composer.fill('hello from the chat view');
  await chat.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('hello from the chat view')).toBeVisible({ timeout: 15000 });
});
