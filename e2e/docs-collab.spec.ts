/**
 * E2E: Phase 7a — Docs & Wikis collaboration (BUILD_PLAN §4.6 acceptance).
 *
 * Three tests:
 *  1. Two browser contexts co-edit the SAME doc page over the Yjs/Hocuspocus
 *     WS channel — A's keystrokes sync to B, A's live cursor is visible in B,
 *     and an OFFLINE edit on B merges (no lost writes) once B reconnects (CRDT).
 *  2. History restore — two stored versions are checkpointed by the 2s store
 *     debounce; restoring the OLDEST version brings back its text after a
 *     reload (server reconstructs the Yjs fragment from the restored BodyJson
 *     snapshot — see collab.server.ts reseedFromJson / onLoadDocument).
 *  3. A doc flagged as a wiki shows the wiki badge and the flag persists across
 *     a reload (retrievable as a wiki).
 *
 * Operational notes
 * ─────────────────
 * 1. This drives REAL browsers + a REAL API. The collab WS server attaches to
 *    the running API at ws://localhost:3001/collab via attachCollabUpgrade
 *    (NODE_ENV != test). Cross-context CRDT sync needs the in-process pubsub
 *    (single dev process) OR Redis (multi-process). The default dev stack is
 *    single-process, so in-process pubsub suffices.
 * 2. Run ONLY against a local/test DB (local Docker ProjectFlow_Test) with
 *    Redis available — NEVER prod. The live run is DEFERRED to a coordinated
 *    local-DB run, mirroring the Phase 3.5 realtime/presence specs. See
 *    MEMORY.md DB_TARGET.
 * 3. Both browser contexts log in (via the UI) as the SAME seeded user. That
 *    user owns the Space, so it has doc.* + EDIT on the doc-page (collab.auth
 *    requires EDIT). The getRealtimeToken server action the editor uses relies
 *    on the session cookie set by the UI login.
 * 4. Waits are on element visibility with explicit timeouts (10–15s for CRDT
 *    sync). The only fixed sleeps are in the history test, where the 2s store
 *    debounce MUST elapse to checkpoint a version (there is no element to wait
 *    on for "the debounce fired").
 */

import { test, expect, request as playwrightRequest, type Page, type APIRequestContext } from '@playwright/test';

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

interface SeededDoc {
  api: APIRequestContext;
  email: string;
  password: string;
  workspaceId: string;
  docId: string;
  docUrl: string;
  pageId: string;
}

/**
 * Register + login a user (API), then seed Workspace → Project(Space) → Doc and
 * resolve the doc's root page. Returns the doc route URL + root page id. The
 * caller logs the SAME user into the browser via uiLogin (the editor's
 * getRealtimeToken relies on the session cookie, not these API tokens).
 */
async function seedDoc(suffix: string, password: string): Promise<SeededDoc> {
  const api = await playwrightRequest.newContext();
  const email = `dc-${suffix}@projectflow.test`;
  const name = `DC User ${suffix}`;

  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status()).toBe(201);

  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(login.status()).toBe(200);
  const { data: { token } } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `DC Workspace ${suffix}`, slug: `dc-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId).toBeTruthy();

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers,
    data: { workspaceId, name: `DC Project ${suffix}`, key: `DC${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const projectId: string = project.Id ?? project.id;
  expect(projectId).toBeTruthy();

  const docRes = await api.post(`${API_BASE}/docs`, {
    headers,
    data: { workspaceId, scopeType: 'SPACE', scopeId: projectId, name: `DC Doc ${suffix}` },
  });
  expect(docRes.status(), 'create doc').toBe(201);
  const doc = (await docRes.json()).data;
  const docId: string = doc.id ?? doc.Id;
  expect(docId).toBeTruthy();

  // Root page — the Doc create seeds one; resolve it via the page list.
  const pagesRes = await api.get(`${API_BASE}/docs/${docId}/pages`, { headers });
  expect(pagesRes.status(), 'list pages').toBe(200);
  const pages = (await pagesRes.json()).data as Array<{ id: string }>;
  expect(pages.length, 'root page present').toBeGreaterThan(0);
  const pageId = pages[0].id;

  return { api, email, password, workspaceId, docId, docUrl: `/docs/${docId}`, pageId };
}

async function cleanup(seed: SeededDoc) {
  const login = await seed.api.post(`${API_BASE}/auth/login`, { data: { email: seed.email, password: seed.password } });
  const { data: { token } } = await login.json();
  const del = await seed.api.delete(`${API_BASE}/workspaces/${seed.workspaceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([204, 404]).toContain(del.status());
  await seed.api.dispose();
}

test.describe('Phase 7a — docs collaboration', () => {
  test('two browsers co-edit with live cursors; offline edit merges on reconnect', async ({ browser }) => {
    const suffix = uniqSuffix();
    const password = 'E2EPass123!';
    const seed = await seedDoc(suffix, password);

    // Two browser contexts, BOTH logging in as the same seeded user (owns the
    // Space → has EDIT; collab.auth requires EDIT). Different contexts give
    // distinct WS connections + distinct awareness cursors.
    const a = await browser.newContext();
    const b = await browser.newContext();
    const pageA = await a.newPage();
    const pageB = await b.newPage();

    await uiLogin(pageA, seed.email, password);
    await uiLogin(pageB, seed.email, password);

    await pageA.goto(seed.docUrl);
    await pageB.goto(seed.docUrl);

    const editorA = pageA.locator('[data-doc-editor] .ProseMirror');
    const editorB = pageB.locator('[data-doc-editor] .ProseMirror');
    await expect(editorA).toBeVisible({ timeout: 15_000 });
    await expect(editorB).toBeVisible({ timeout: 15_000 });

    // A types → B sees it (CRDT sync over the WS channel).
    await editorA.click();
    await editorA.type('Hello from A. ');
    await expect(editorB).toContainText('Hello from A.', { timeout: 15_000 });

    // A's live cursor/caret label is visible in B (CollaborationCursor awareness).
    await expect(pageB.locator('.collaboration-cursor__label').first()).toBeVisible({ timeout: 15_000 });

    // OFFLINE MERGE: drop B's network, both edit concurrently, then restore B.
    await b.setOffline(true);
    await editorB.click();
    await editorB.type('Offline edit from B. ');
    await editorA.click();
    await editorA.type('Concurrent edit from A. ');
    await b.setOffline(false);

    // After reconnect, BOTH edits appear in BOTH editors — no lost writes.
    await expect(editorA).toContainText('Offline edit from B.', { timeout: 15_000 });
    await expect(editorB).toContainText('Concurrent edit from A.', { timeout: 15_000 });

    await a.close();
    await b.close();
    await cleanup(seed);
  });

  test('history restores a prior version', async ({ browser }) => {
    const suffix = uniqSuffix();
    const password = 'E2EPass123!';
    const seed = await seedDoc(suffix, password);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, seed.email, password);
    await page.goto(seed.docUrl);

    const editor = page.locator('[data-doc-editor] .ProseMirror');
    await expect(editor).toBeVisible({ timeout: 15_000 });

    // Edit, let the 2s store debounce checkpoint version #1, then edit again so
    // a later store checkpoints version #2. (The store hook writes a
    // DocPageVersions row on each persist — see collab.server.ts enhancement 1.)
    await editor.click();
    await editor.type('Version one content. ');
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(3_000); // 2s debounce + margin → version #1 checkpoint
    await editor.type('Version two content. ');
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(3_000); // → version #2 checkpoint

    // The history panel fetches versions on mount only (it does not live-update
    // during active editing — a documented minor limitation; see DECISIONS).
    // Reload so the panel remounts and lists the two checkpoints just created
    // (the realistic "reopen the doc → view its history" flow).
    await page.reload();
    await expect(editor).toBeVisible({ timeout: 15_000 });

    // The history panel lists versions newest→oldest; `.last()` is the OLDEST
    // (the "Version one" checkpoint). Wait for it, then restore it.
    const oldest = page.locator('[data-doc-version]').last();
    await expect(oldest).toBeVisible({ timeout: 15_000 });
    await oldest.getByRole('button', { name: /restore/i }).click();

    // Restore nulls BodyYjs + sets BodyJson to the snapshot. Reload to drop the
    // live Yjs doc and force a fresh WS connect → onLoadDocument reconstructs
    // the Yjs fragment from the restored JSON (reseedFromJson). The editor then
    // shows the restored text and NOT the later "Version two" addition.
    await page.reload();
    const editorAfter = page.locator('[data-doc-editor] .ProseMirror');
    await expect(editorAfter).toContainText('Version one content.', { timeout: 15_000 });
    await expect(editorAfter).not.toContainText('Version two content.', { timeout: 15_000 });

    await ctx.close();
    await cleanup(seed);
  });

  test('a doc marked as wiki is flagged and retrievable', async ({ browser }) => {
    const suffix = uniqSuffix();
    const password = 'E2EPass123!';
    const seed = await seedDoc(suffix, password);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await uiLogin(page, seed.email, password);
    await page.goto(seed.docUrl);

    await page.locator('[data-wiki-toggle]').click();
    await expect(page.locator('[data-wiki-badge]')).toBeVisible({ timeout: 15_000 });

    // Reload → the flag persists (the doc is retrievable as a wiki).
    await page.reload();
    await expect(page.locator('[data-wiki-badge]')).toBeVisible({ timeout: 15_000 });

    await ctx.close();
    await cleanup(seed);
  });
});
