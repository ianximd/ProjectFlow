/**
 * Phase 7a — collab persistence integration.
 * Exercises onStoreDocument's write path: a Yjs doc → BodyYjs + BodyJson in DocPages.
 * DB SAFETY: must target local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { CollabRepository } from '../collab.repository.js';
import { renderSnapshot } from '../yjsPersistence.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('collab persistence', () => {
  it('persists Yjs binary + JSON snapshot and loads it back', async () => {
    const owner = await createTestUser({ email: `collab-${Date.now()}@projectflow.test` });
    const token = owner.accessToken;
    const ws = await createTestWorkspace(token);
    const space = await createTestProject(ws.Id, token, { name: 'C', key: `CB${Date.now() % 100000}` });
    const doc = (await json<{ data: any }>(await request('/docs', { method: 'POST', token, json: { workspaceId: ws.Id, scopeType: 'SPACE', scopeId: space.Id, name: 'D' } }), 201)).data;
    const page = (await json<{ data: any[] }>(await request(`/docs/${doc.id}/pages`, { token }))).data[0];

    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('prosemirror');
    const el = new Y.XmlElement('paragraph');
    el.insert(0, [new Y.XmlText('persisted body')]);
    frag.insert(0, [el]);

    const repo = new CollabRepository();
    await repo.persistYjs(page.id, Buffer.from(Y.encodeStateAsUpdate(ydoc)), renderSnapshot(ydoc));

    const loaded = await repo.loadYjs(page.id);
    expect(loaded.bodyYjs).not.toBeNull();
    expect(loaded.bodyYjs!.length).toBeGreaterThan(0);
    expect(loaded.bodyJson).toContain('persisted body');

    // SSR first-paint reads BodyJson via the page GET.
    const fetched = (await json<{ data: any }>(await request(`/docs/${doc.id}/pages`, { token }))).data;
    expect(fetched.length).toBe(1);
  });
});
