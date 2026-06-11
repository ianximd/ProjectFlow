/**
 * E2E: Phase 7b — Whiteboards (BUILD_PLAN §4.7 acceptance).
 *
 * Two tests that prove the headline acceptance WITHOUT relying on fragile
 * tldraw canvas-click selectors. Both drive the canvas through a dev-only
 * `window.__wbEditor` handle (the live tldraw Editor) exposed by
 * WhiteboardCanvas.handleMount under a non-production guard, plus the two
 * module-level tldraw helpers it also publishes on `window.__wbTldraw`
 * (createShapeId / toRichText) — these are tldraw module exports, NOT editor
 * methods, so they are otherwise unreachable inside page.evaluate.
 *
 *  1. sticky → task: a `note` shape carrying known rich text is created +
 *     selected programmatically; the ConvertToTaskPanel's "Convert to task"
 *     button mints a REAL task in the seeded List. The assertion is
 *     DETERMINISTIC — it polls GET /tasks?projectId=<spaceId> over the REST API
 *     until the task with that exact title exists (no DOM/canvas inspection).
 *
 *  2. two-browser co-edit: a note created in browser A appears in browser B on
 *     the SAME `whiteboard:<id>` Yjs channel. The load-bearing assertion reads
 *     the tldraw STORE in B (editor.getCurrentPageShapes() → the note's
 *     props.richText carries A's text), never the DOM canvas.
 *
 * Operational notes
 * ─────────────────
 * 1. Drives REAL browsers + a REAL API. The collab WS server attaches to the
 *    running API at ws://localhost:3001/collab; `whiteboard:<id>` is its
 *    reserved channel kind (Phase 7a spine). Cross-context CRDT sync needs the
 *    in-process pubsub (single dev process) OR Redis (multi-process). The
 *    default dev stack is single-process, so in-process pubsub suffices.
 * 2. Run ONLY against a local/test DB (local Docker ProjectFlow_Test) — NEVER
 *    prod. The live run is DEFERRED to a coordinated local-DB run, mirroring the
 *    Phase 7a docs-collab spec. See MEMORY.md DB_TARGET.
 * 3. Both browser contexts log in (via the UI) as the SAME seeded user. That
 *    user owns the Space, so it has VIEW on the board scope + EDIT on the List
 *    (collab.auth + convert-to-task's LIST EDIT gate both require EDIT).
 * 4. All waits are on store/element state with explicit timeouts (15–20s for
 *    CRDT sync) — no fixed sleeps.
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

interface SeededBoard {
  api: APIRequestContext;
  email: string;
  password: string;
  token: string;
  workspaceId: string;
  spaceId: string;
  listId: string;
  whiteboardId: string;
  boardUrl: string;
}

/**
 * Register + login a user (API), then seed Workspace → Project(Space) → List →
 * Whiteboard scoped to that Space. The List is what makes convert-to-task's LIST
 * EDIT gate resolve AND what gives the minted task a derivable projectId so it
 * surfaces under GET /tasks?projectId=<spaceId>. The caller logs the SAME user
 * into the browser via uiLogin (the editor's getRealtimeToken relies on the
 * session cookie, not this API token).
 */
async function seedBoard(suffix: string, password: string): Promise<SeededBoard> {
  const api = await playwrightRequest.newContext();
  const email = `wb-${suffix}@projectflow.test`;
  const name = `WB User ${suffix}`;

  expect((await api.post(`${API_BASE}/auth/register`, { data: { email, name, password } })).status()).toBe(201);

  const login = await api.post(`${API_BASE}/auth/login`, { data: { email, password } });
  expect(login.status()).toBe(200);
  const { data: { token } } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  const ws = (await (await api.post(`${API_BASE}/workspaces`, {
    headers, data: { name: `WB Workspace ${suffix}`, slug: `wb-ws-${suffix}` },
  })).json()).data;
  const workspaceId: string = ws.Id ?? ws.id;
  expect(workspaceId).toBeTruthy();

  const project = (await (await api.post(`${API_BASE}/projects`, {
    headers,
    data: { workspaceId, name: `WB Project ${suffix}`, key: `WB${suffix.slice(-4).toUpperCase()}`, type: 'KANBAN' },
  })).json()).data;
  const spaceId: string = project.Id ?? project.id;
  expect(spaceId).toBeTruthy();

  const list = (await (await api.post(`${API_BASE}/lists`, {
    headers, data: { workspaceId, spaceId, folderId: null, name: `WB List ${suffix}`, position: 0 },
  })).json()).data;
  const listId: string = list.id ?? list.Id;
  expect(listId).toBeTruthy();

  const wbRes = await api.post(`${API_BASE}/whiteboards`, {
    headers, data: { workspaceId, scopeType: 'SPACE', scopeId: spaceId, name: `WB Board ${suffix}` },
  });
  expect(wbRes.status(), 'create whiteboard').toBe(201);
  const wb = (await wbRes.json()).data;
  const whiteboardId: string = wb.id ?? wb.Id;
  expect(whiteboardId).toBeTruthy();

  return {
    api, email, password, token, workspaceId, spaceId, listId, whiteboardId,
    boardUrl: `/whiteboards/${whiteboardId}`,
  };
}

async function cleanup(seed: SeededBoard) {
  const del = await seed.api.delete(`${API_BASE}/workspaces/${seed.workspaceId}`, {
    headers: { Authorization: `Bearer ${seed.token}` },
  });
  expect([204, 404]).toContain(del.status());
  await seed.api.dispose();
}

/** Wait until the dev-only tldraw editor handle is published on the page. */
async function waitForEditor(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as { __wbEditor?: unknown }).__wbEditor
      && !!(window as unknown as { __wbTldraw?: unknown }).__wbTldraw,
    null,
    { timeout: 20_000 },
  );
}

/**
 * Create + select a `note` shape carrying `text` via the editor handle.
 * Uses the page-realm tldraw helpers (window.__wbTldraw) to build a v5 rich-text
 * doc (toRichText) and a fresh shape id (createShapeId) — see the d.ts example
 * `editor.createShape({ id, type, props: { richText: toRichText("ok") } })`.
 * Returns the created shape id.
 */
async function createNote(page: Page, text: string): Promise<string> {
  return page.evaluate((noteText) => {
    const ed = (window as unknown as { __wbEditor: any }).__wbEditor;
    const { createShapeId, toRichText } = (window as unknown as {
      __wbTldraw: { createShapeId: () => string; toRichText: (s: string) => unknown };
    }).__wbTldraw;
    const id = createShapeId();
    ed.createShape({ id, type: 'note', x: 200, y: 200, props: { richText: toRichText(noteText) } });
    ed.select(id);
    return id as string;
  }, text);
}

// ── Test 1 — a sticky note converts into a real task ───────────────────────────
test('a sticky note converts into a real task in the chosen list', async ({ browser }) => {
  const suffix = uniqSuffix();
  const password = 'E2EPass123!';
  const seed = await seedBoard(suffix, password);
  const taskTitle = `Design the onboarding flow ${suffix}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await uiLogin(page, seed.email, password);
  await page.goto(seed.boardUrl);

  // Wait for tldraw to mount and publish the dev handle.
  await waitForEditor(page);

  // Create + select a note carrying the known title text → ConvertToTaskPanel
  // renders (driven by editor.getOnlySelectedShape in WhiteboardCanvas).
  await createNote(page, taskTitle);

  // The convert panel appears; its target-list <select> auto-selects the first
  // (only) seeded List. Click "Convert to task".
  const convertBtn = page.getByRole('button', { name: /convert to task/i });
  await expect(convertBtn).toBeVisible({ timeout: 15_000 });
  await convertBtn.click();

  // DETERMINISTIC assertion: poll the REST API until the task exists in the
  // space. GET /tasks?projectId=<spaceId> → { data: [...], meta: {...} }. The
  // minted task lives in the seeded List (inside the space) so it surfaces here.
  await expect
    .poll(
      async () => {
        const res = await seed.api.get(`${API_BASE}/tasks?projectId=${seed.spaceId}`, {
          headers: { Authorization: `Bearer ${seed.token}` },
        });
        const body = await res.json();
        const tasks: any[] = body.data ?? [];
        return tasks.some((t) => (t.title ?? t.Title) === taskTitle);
      },
      { timeout: 15_000, intervals: [500, 1000, 1500, 2000] },
    )
    .toBe(true);

  await ctx.close();
  await cleanup(seed);
});

// ── Test 2 — a shape created in browser A appears in browser B ─────────────────
test('two browsers co-edit: a shape created in A appears in B over the whiteboard channel', async ({ browser }) => {
  const suffix = uniqSuffix();
  const password = 'E2EPass123!';
  const seed = await seedBoard(suffix, password);
  const noteText = `synced-note-${suffix}`;

  // Two contexts → distinct WS connections on the same whiteboard:<id> channel,
  // BOTH logged in as the same seeded user (owns the Space → has EDIT).
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();

  await uiLogin(pageA, seed.email, password);
  await uiLogin(pageB, seed.email, password);

  await pageA.goto(seed.boardUrl);
  await pageB.goto(seed.boardUrl);

  await waitForEditor(pageA);
  await waitForEditor(pageB);

  // A creates a note carrying a distinctive marker (the Yjs binding propagates
  // it to B over the WS channel).
  await createNote(pageA, noteText);

  // STORE-level assertion in B: poll the tldraw store until a shape carrying A's
  // text arrives. toRichText stores the text inside props.richText as a
  // ProseMirror doc ({type:'doc',content:[{type:'paragraph',content:[{type:'text',
  // text:'…'}]}]}), so JSON.stringify(s.props) literally contains the marker.
  await expect
    .poll(
      async () =>
        pageB.evaluate(() => {
          const ed = (window as unknown as { __wbEditor: any }).__wbEditor;
          const shapes = ed.getCurrentPageShapes ? ed.getCurrentPageShapes() : [];
          return shapes
            .map((s: any) => {
              try {
                return JSON.stringify(s.props ?? {});
              } catch {
                return '';
              }
            })
            .join(' ');
        }),
      { timeout: 20_000, intervals: [500, 1000, 2000, 3000] },
    )
    .toContain('synced-note');

  await a.close();
  await b.close();
  await cleanup(seed);
});
