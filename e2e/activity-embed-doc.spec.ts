/**
 * E2E: Phase 9e — Activity / Embed / Doc views.
 *
 * Headline acceptance (BUILD_PLAN §8.5):
 *  - Activity: a hierarchy-scoped, reverse-chronological AuditLogEntry feed that
 *    SSR-seeds from usp_AuditLog_List and LIVE-prepends a synthetic entry off the
 *    shared `taskEvents` subscription when a task changes in a second context
 *    (no new realtime channel — same topic the other view surfaces use).
 *  - Embed: a sandboxed <iframe> over the view's config.url, carrying the exact
 *    sandbox + referrerPolicy="no-referrer" attributes. The URL was allow-listed
 *    + normalized server-side (normalizeEmbedUrl) at create time.
 *  - Doc: a feature-flagged stub (DOCS_FEATURE_ENABLED=false) reading config.docId,
 *    ready to flip on when the Phase 7 reader is wired.
 *
 * All seeding is API-driven (robust vs UI selectors). Requires a local/test DB +
 * REDIS — run ONLY with explicit local DB env (DB_NAME=ProjectFlow_Test …) so it
 * never touches prod. See e2e/README.md.
 */

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api/v1';
const EMPTY_CONFIG = { filter: { conjunction: 'AND', rules: [] }, sort: [] };

function uniqSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function gql<T = any>(api: APIRequestContext, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await api.post(`${API_BASE}/graphql`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { query, variables },
  });
  const body = await res.json();
  expect(body.errors, JSON.stringify(body.errors)).toBeUndefined();
  return body.data as T;
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

interface Seed {
  email: string; password: string; token: string; api: APIRequestContext;
  workspaceId: string; projectId: string; listId: string;
  activityViewId: string; embedViewId: string; docViewId: string;
  titleA: string;
}

/** Seed a Space with one task (writes an AuditLog row) + an activity, embed, and
 *  doc SavedView over that Space. */
async function seed(): Promise<Seed> {
  const suffix = uniqSuffix();
  const password = 'E2EPass123!';
  const email = `aed-${suffix}@projectflow.test`;
  const titleA = `AED Task ${suffix}`;
  const api = await playwrightRequest.newContext();

  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name: `AED ${suffix}`, password } })).status()).toBe(201);
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email, password } })).json();
  const h = { Authorization: `Bearer ${token}` };

  const ws = (await (await api.post(`${API_BASE}/workspaces`, { headers: h, data: { name: `AW ${suffix}`, slug: `aw-${suffix}` } })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers: h, data: { workspaceId, name: `AP ${suffix}`, key: `A${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = project.Id ?? project.id;
  const list = (await (await api.post(`${API_BASE}/lists`, {
    headers: h, data: { workspaceId, spaceId: projectId, folderId: null, name: 'L', position: 0 },
  })).json()).data;
  const listId: string = list.id ?? list.Id;

  // One task — its create writes an AuditLog row (audit middleware on /tasks) so
  // the SSR activity feed is non-empty.
  expect((await api.post(`${API_BASE}/tasks`, { headers: h, data: { workspaceId, projectId, title: titleA, listId } })).status()).toBeLessThan(300);

  const mkView = async (type: string, name: string, config: Record<string, unknown>) => {
    const d = await gql<{ createSavedView: { id: string } }>(api, token,
      `mutation($i: CreateSavedViewInput!){ createSavedView(input:$i){ id } }`,
      { i: { scopeType: 'SPACE', scopeId: projectId, type, name, isShared: true, isDefault: false, config: JSON.stringify(config) } });
    return d.createSavedView.id;
  };
  const activityViewId = await mkView('activity', 'ActivityV', EMPTY_CONFIG);
  const embedViewId = await mkView('embed', 'EmbedV', { ...EMPTY_CONFIG, url: 'https://example.com/' });
  const docViewId = await mkView('doc', 'DocV', { ...EMPTY_CONFIG, docId: `doc-${suffix}` });

  return { email, password, token, api, workspaceId, projectId, listId, activityViewId, embedViewId, docViewId, titleA };
}

test.describe('Phase 9e — Activity / Embed / Doc', () => {
  test('Activity feed live-prepends a task event; Embed renders a sandboxed iframe; Doc shows the flagged stub', async ({ browser }) => {
    const s = await seed();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, s.email, s.password);

    // ── Activity: open the feed, arm the live subscription ─────────────────────
    const subLive = page.waitForResponse(
      (r) => r.url().includes('/api/v1/graphql') && r.request().method() === 'POST'
        && /taskEvents|TaskEvents/.test(r.request().postData() ?? ''),
      { timeout: 25_000 },
    );
    await page.goto(`/views/SPACE/${s.projectId}?viewId=${s.activityViewId}`);
    await expect(page.getByTestId('view-body-activity')).toBeVisible({ timeout: 20_000 });
    await subLive;
    await page.waitForTimeout(1500); // settle the Redis SUBSCRIBE before publishing

    const before = await page.getByTestId('activity-entry').count();

    // Create a second task from the API (a second "context") → publishes a
    // `taskEvents created` → the Activity feed prepends a synthetic CREATE entry.
    expect((await s.api.post(`${API_BASE}/tasks`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { workspaceId: s.workspaceId, projectId: s.projectId, title: `Live ${uniqSuffix()}`, listId: s.listId },
    })).status()).toBeLessThan(300);

    await expect.poll(async () => page.getByTestId('activity-entry').count(), { timeout: 20_000 }).toBeGreaterThan(before);
    await expect(page.getByTestId('activity-entry').first()).toHaveAttribute('data-action', /CREATE|UPDATE/);

    // ── Embed: sandboxed iframe over the normalized config.url ──────────────────
    await page.goto(`/views/SPACE/${s.projectId}?viewId=${s.embedViewId}`);
    const iframe = page.getByTestId('embed-iframe');
    await expect(iframe).toBeVisible({ timeout: 20_000 });
    await expect(iframe).toHaveAttribute('src', 'https://example.com/');
    await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/);
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');

    // ── Doc: feature-flagged stub renders (Phase 7 reader not wired this slice) ──
    await page.goto(`/views/SPACE/${s.projectId}?viewId=${s.docViewId}`);
    const doc = page.getByTestId('view-body-doc');
    await expect(doc).toBeVisible({ timeout: 20_000 });
    await expect(doc).toHaveAttribute('data-doc-stub', 'true');

    await ctx.close();
    await s.api.dispose();
  });
});
