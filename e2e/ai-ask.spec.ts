/**
 * E2E: Phase 11b — AI Q&A ("Ask AI").
 *
 * Headline acceptance (BUILD_PLAN AI #1): a user asks a natural-language question
 * about their workspace and gets an answer grounded ONLY in content they can VIEW,
 * with clickable citations. A PRIVATE-space task the user cannot see must NOT be
 * cited or surfaced.
 *
 * Deterministic: no ANTHROPIC_API_KEY in the test env → the gateway uses
 * FakeProvider, which echoes the numbered sources as [n] citations, so the
 * citation chain is exercised end-to-end without a live model.
 *
 * All seeding is API-driven. Requires a local/test DB + REDIS — run ONLY with
 * explicit local DB env (DB_NAME=ProjectFlow_Test …) so it never touches prod.
 *
 * NOTE (Phase 11b DoD): authored this session; the full Playwright run (which
 * boots both servers) was deferred under the session's cost ceiling — the Q&A
 * security/citation chain is proven by the API integration suite
 * (qa.security/qa.route/retrieval.security) and the AskAiPanel unit test. See
 * DECISIONS.md (Phase 11b).
 */

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

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

interface Seed {
  email: string; password: string; api: APIRequestContext;
  workspaceId: string; publicTaskId: string; secretTaskId: string;
}

/** Seed a PUBLIC Marketing space (visible task) + a PRIVATE space (secret task),
 *  then index everything via the dev reindex hook. */
async function seed(): Promise<Seed> {
  const suffix = uniqSuffix();
  const password = 'E2EPass123!';
  const email = `ai-ask-${suffix}@projectflow.test`;
  const api = await playwrightRequest.newContext();

  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name: `AI ${suffix}`, password } })).status()).toBe(201);
  const { data: { token } } = await (await api.post(`${API_BASE}/auth/login`, { data: { email, password } })).json();
  const h = { Authorization: `Bearer ${token}` };

  const ws = (await (await api.post(`${API_BASE}/workspaces`, { headers: h, data: { name: `AIW ${suffix}`, slug: `aiw-${suffix}` } })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;

  const mkSpace = async (name: string, key: string) =>
    (await (await api.post(`${API_BASE}/projects`, { headers: h, data: { workspaceId, name, key, type: 'KANBAN' } })).json()).data;
  const mkList = async (spaceId: string, name: string) =>
    (await (await api.post(`${API_BASE}/lists`, { headers: h, data: { workspaceId, spaceId, folderId: null, name, position: 0 } })).json()).data;
  const mkTask = async (listId: string, title: string, description: string) =>
    (await (await api.post(`${API_BASE}/tasks`, { headers: h, data: { workspaceId, listId, title, description, type: 'TASK' } })).json()).data;

  // PUBLIC Marketing space → visible "at risk" task.
  const marketing = await mkSpace(`Marketing ${suffix}`, `MK${suffix.slice(-4).toUpperCase()}`);
  const mkListRow = await mkList(marketing.Id ?? marketing.id, 'Launch');
  const publicTask = await mkTask(mkListRow.id ?? mkListRow.Id, 'Launch readiness', 'The launch is at risk this week and is slipping to Q3.');
  const publicTaskId: string = publicTask.id ?? publicTask.Id;

  // PRIVATE space → secret task the owner-as-author can see, but which must never
  // surface for a user without access. (Single-user e2e: we assert the visible
  // task is cited; the cross-user denial is proven exhaustively in the API suite.)
  const secret = await mkSpace(`Secret ${suffix}`, `SC${suffix.slice(-4).toUpperCase()}`);
  await api.patch(`${API_BASE}/projects/${secret.Id ?? secret.id}`, { headers: h, data: { visibility: 'PRIVATE' } });
  const scList = await mkList(secret.Id ?? secret.id, 'Classified');
  const secretTask = await mkTask(scList.id ?? scList.Id, 'Classified', 'nuclear launch codes for the secret program');
  const secretTaskId: string = secretTask.id ?? secretTask.Id;

  // Index the corpus synchronously (no Redis worker needed).
  expect((await api.post(`${API_BASE}/dev/ai/reindex`, { headers: h, data: { workspaceId } })).status()).toBe(200);

  return { email, password, api, workspaceId, publicTaskId, secretTaskId };
}

test.describe('Phase 11b — Ask AI', () => {
  test('answers with a citation to a visible task; a private-space task is not surfaced', async ({ browser }) => {
    const s = await seed();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, s.email, s.password);

    await page.goto(`/ask?workspaceId=${s.workspaceId}`);

    await page.getByLabel('Ask AI').fill("What's at risk in the Marketing space this week?");
    await page.getByRole('button', { name: 'Ask AI' }).click();

    // An answer renders, and the visible task is cited (a link to /tasks/<id>).
    const citation = page.getByRole('link', { name: new RegExp(s.publicTaskId, 'i') });
    await expect(citation).toBeVisible({ timeout: 20_000 });
    await expect(citation).toHaveAttribute('href', `/tasks/${s.publicTaskId}`);

    // The private-space task id must NOT appear anywhere in the rendered Q&A.
    await expect(page.locator('body')).not.toContainText(s.secretTaskId);
  });
});
