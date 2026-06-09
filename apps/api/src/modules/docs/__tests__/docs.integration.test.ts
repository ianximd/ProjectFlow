/**
 * Phase 7a — Docs & Wikis integration coverage.
 * Page CRUD + nested move; history restore; create-task-from-doc; wiki flag.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedDoc() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const owner = await createTestUser({ email: `doc-${stamp}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, {
    name: 'Doc Space',
    key: `DC${stamp.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`,
  });
  const doc = (await json<{ data: any }>(await request('/docs', {
    method: 'POST',
    token,
    json: { workspaceId: ws.Id, scopeType: 'SPACE', scopeId: space.Id, name: 'Handbook' },
  }), 201)).data;
  return { token, userId: owner.user.Id, ws, space, doc };
}

describe('docs', () => {
  it('creates a doc with a root page and lists its tree', async () => {
    const { token, doc } = await seedDoc();
    const tree = (await json<{ data: any[] }>(await request(`/docs/${doc.id}/pages`, { token }))).data;
    expect(tree.length).toBe(1);
    expect(tree[0].parentPageId).toBeNull();
  });

  it('creates nested pages and moves one under another', async () => {
    const { token, doc } = await seedDoc();
    const a = (await json<{ data: any }>(
      await request('/docs/pages', { method: 'POST', token, json: { docId: doc.id } }),
    201)).data;
    const b = (await json<{ data: any }>(
      await request('/docs/pages', { method: 'POST', token, json: { docId: doc.id } }),
    201)).data;

    const moved = (await json<{ data: any }>(
      await request(`/docs/pages/${b.id}/move`, {
        method: 'POST', token, json: { parentPageId: a.id, afterPageId: null },
      }),
    )).data;
    expect(moved.parentPageId).toBe(a.id);
  });

  it('rejects moving a page under its own descendant (cycle)', async () => {
    const { token, doc } = await seedDoc();
    const a = (await json<{ data: any }>(
      await request('/docs/pages', { method: 'POST', token, json: { docId: doc.id } }),
    201)).data;
    const child = (await json<{ data: any }>(
      await request('/docs/pages', { method: 'POST', token, json: { docId: doc.id, parentPageId: a.id } }),
    201)).data;
    const res = await request(`/docs/pages/${a.id}/move`, {
      method: 'POST', token, json: { parentPageId: child.id, afterPageId: null },
    });
    expect(res.status).toBe(409);
  });

  it('restores a prior version', async () => {
    const { token, doc } = await seedDoc();
    const page = (await json<{ data: any[] }>(
      await request(`/docs/${doc.id}/pages`, { token }),
    )).data[0];

    // Seed a version snapshot via the history endpoint.
    await request(`/docs/pages/${page.id}/versions`, {
      method: 'POST', token,
      json: { snapshot: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v1' }] }] }) },
    });
    const versions = (await json<{ data: any[] }>(
      await request(`/docs/pages/${page.id}/versions`, { token }),
    )).data;
    expect(versions.length).toBeGreaterThanOrEqual(1);

    const restored = (await json<{ data: any }>(
      await request(`/docs/pages/${page.id}/versions/${versions[0].id}/restore`, {
        method: 'POST', token, json: {},
      }),
    )).data;
    expect(restored.bodyJson).toContain('v1');
  });

  it('creates a task from a doc selection and links it', async () => {
    const { token, doc, ws, space } = await seedDoc();
    const page = (await json<{ data: any[] }>(
      await request(`/docs/${doc.id}/pages`, { token }),
    )).data[0];

    const list = (await json<{ data: any }>(await request('/lists', {
      method: 'POST', token,
      json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
    }), 201)).data;

    const link = (await json<{ data: any }>(
      await request(`/docs/pages/${page.id}/create-task`, {
        method: 'POST', token,
        json: { listId: list.id ?? list.Id, title: 'Follow-up from doc' },
      }),
    201)).data;
    expect(link.taskTitle).toBe('Follow-up from doc');

    const links = (await json<{ data: any[] }>(
      await request(`/docs/pages/${page.id}/links`, { token }),
    )).data;
    expect(links.map((l: any) => l.id)).toContain(link.id);
  });

  // ── Negative-authz: cross-tenant holes ──────────────────────────────────────

  it('rejects create-task-from-doc when caller lacks EDIT on target list (cross-tenant)', async () => {
    // User X owns doc D in workspace A.
    const { token: tokenX, doc, ws: wsA, space: spaceA } = await seedDoc();
    const pageA = (await json<{ data: any[] }>(
      await request(`/docs/${doc.id}/pages`, { token: tokenX }),
    )).data[0];

    // User Y owns list L in workspace B — X has no access to workspace B at all.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userY = await createTestUser({ email: `attacker-${stamp}@projectflow.test` });
    const wsB   = await createTestWorkspace(userY.accessToken);
    const spaceB = await createTestProject(wsB.Id, userY.accessToken, {
      name: 'Attacker Space',
      key: `AT${stamp.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`,
    });
    const listB = (await json<{ data: any }>(await request('/lists', {
      method: 'POST',
      token: userY.accessToken,
      json: { workspaceId: wsB.Id, spaceId: spaceB.Id, folderId: null, name: 'Attacker List', position: 0 },
    }), 201)).data;

    // X attempts to create a task in Y's list via the doc endpoint.
    const res = await request(`/docs/pages/${pageA.id}/create-task`, {
      method: 'POST',
      token: tokenX,
      json: { listId: listB.id ?? listB.Id, title: 'Injected task' },
    });
    // Must be 403 (or 404 fail-closed) — never 201.
    expect([403, 404]).toContain(res.status);
  });

  it('rejects GET /docs when caller has no VIEW access to the scope (cross-tenant)', async () => {
    // User Y owns a space in workspace B.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userY = await createTestUser({ email: `owner-${stamp}@projectflow.test` });
    const wsB   = await createTestWorkspace(userY.accessToken);
    const spaceB = await createTestProject(wsB.Id, userY.accessToken, {
      name: 'Private Space',
      key: `PR${stamp.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`,
    });
    // Seed a doc in that space so it would appear if the query ran.
    await json<{ data: any }>(await request('/docs', {
      method: 'POST',
      token: userY.accessToken,
      json: { workspaceId: wsB.Id, scopeType: 'SPACE', scopeId: spaceB.Id, name: 'Private Doc' },
    }), 201);

    // User X — a completely separate tenant — tries to list docs for Y's space.
    const { token: tokenX } = await seedDoc();
    const res = await request(`/docs?scopeType=SPACE&scopeId=${spaceB.Id}`, { token: tokenX });
    // Must be 403 or 404 fail-closed — never 200 with Y's docs.
    expect([403, 404]).toContain(res.status);
  });

  it('marks a doc as wiki and reads the flag back', async () => {
    const { token, doc } = await seedDoc();
    const wiki = (await json<{ data: any }>(
      await request(`/docs/${doc.id}/wiki`, { method: 'PUT', token, json: { isWiki: true } }),
    )).data;
    expect(wiki.isWiki).toBe(true);
    expect(wiki.verifiedById).not.toBeNull();

    const read = (await json<{ data: any }>(await request(`/docs/${doc.id}`, { token }))).data;
    expect(read.isWiki).toBe(true);
  });
});
