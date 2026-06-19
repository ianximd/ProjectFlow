/**
 * Phase 11b — Task 4: POST /ai/ask HTTP route integration test.
 *
 *   1. Owner POSTs /ai/ask { workspaceId, question } → 200 { data: { answer, citations } };
 *      the public task is cited.
 *   2. A non-member (no workspace membership) → 403 (ai.use gate).
 *   3. A guest with a LIST grant but no ai.use → 403 (ai.use gate).
 *
 * Corpus seeded via POST /dev/ai/reindex (no Redis). Deterministic via FakeProvider.
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function mkList(wsId: string, spaceId: string, token: string, name: string): Promise<string> {
  const d = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: wsId, spaceId, folderId: null, name, position: 0 },
  }), 201)).data;
  return d.id ?? d.Id;
}

async function mkTask(wsId: string, listId: string, token: string, title: string, description: string): Promise<string> {
  const d = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token, json: { workspaceId: wsId, listId, title, description, type: 'TASK' },
  }), 201)).data;
  return d.id ?? d.Id;
}

async function reindex(token: string, workspaceId: string) {
  return json<{ data: any }>(await request('/dev/ai/reindex', { method: 'POST', token, json: { workspaceId } }), 200);
}

async function ask(token: string, body: Record<string, unknown>): Promise<Response> {
  return request('/ai/ask', { method: 'POST', token, json: body });
}

async function inviteGuest(
  ownerToken: string, wsId: string, email: string,
  grant: { objectType: 'SPACE' | 'FOLDER' | 'LIST'; objectId: string; level: 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL' },
): Promise<{ token: string }> {
  const guest = await createTestUser({ email });
  const { invite } = await json<{ invite: any }>(await request('/guests/invites', {
    method: 'POST', token: ownerToken,
    json: { workspaceId: wsId, email, objectType: grant.objectType, objectId: grant.objectId, level: grant.level },
  }), 201);
  await json(await request(`/guests/invites/${invite.token}/accept`, {
    method: 'POST', token: guest.accessToken, json: {},
  }), 200);
  return { token: guest.accessToken };
}

interface Scenario {
  ownerToken: string;
  workspaceId: string;
  publicListId: string;
  lunchTaskId: string;
}

async function seedScenario(): Promise<Scenario> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const key5 = (p: string) => `${p}${stamp.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}`;

  const owner = await createTestUser({ email: `ask-owner-${stamp}@projectflow.test` });
  const ownerToken = owner.accessToken;
  const ws = await createTestWorkspace(ownerToken);

  const space = await createTestProject(ws.Id, ownerToken, { name: 'Open Space', key: key5('OP') });
  const publicListId = await mkList(ws.Id, space.Id, ownerToken, 'Public List');
  const lunchTaskId = await mkTask(ws.Id, publicListId, ownerToken, 'Team lunch friday', 'lunch plans for friday downtown');

  return { ownerToken, workspaceId: ws.Id, publicListId, lunchTaskId };
}

describe('POST /ai/ask', () => {
  it('1. owner gets 200 { answer, citations } and cites the public task', async () => {
    const s = await seedScenario();
    const counts = await reindex(s.ownerToken, s.workspaceId);
    expect(counts.data.tasks).toBeGreaterThanOrEqual(1);

    const res = await ask(s.ownerToken, { workspaceId: s.workspaceId, question: 'what are the lunch plans friday downtown?' });
    expect(res.status).toBe(200);

    const body = await json<{ data: { answer: string; citations: { objectType: string; objectId: string }[] } }>(res);
    expect(typeof body.data.answer).toBe('string');
    expect(Array.isArray(body.data.citations)).toBe(true);

    const citedIds = body.data.citations.map((c) => c.objectId.toLowerCase());
    expect(citedIds).toContain(s.lunchTaskId.toLowerCase());
  });

  it('2. a non-member gets 403', async () => {
    const s = await seedScenario();
    await reindex(s.ownerToken, s.workspaceId);
    const outsider = await createTestUser({ email: `ask-outsider-${Date.now()}@projectflow.test` });
    const res = await ask(outsider.accessToken, { workspaceId: s.workspaceId, question: 'lunch?' });
    expect(res.status).toBe(403);
  });

  it('3. a guest with a LIST grant but no ai.use gets 403', async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const s = await seedScenario();
    await reindex(s.ownerToken, s.workspaceId);
    const guest = await inviteGuest(s.ownerToken, s.workspaceId, `ask-guest-${stamp}@vendor.io`, {
      objectType: 'LIST', objectId: s.publicListId, level: 'VIEW',
    });
    const res = await ask(guest.token, { workspaceId: s.workspaceId, question: 'lunch?' });
    expect(res.status).toBe(403);
  });
});
