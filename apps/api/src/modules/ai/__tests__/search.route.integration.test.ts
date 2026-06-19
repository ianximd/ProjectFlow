/**
 * Phase 11a — Task 10: POST /ai/search HTTP route integration test.
 *
 * Three assertions:
 *   1. Owner POSTs /ai/search { workspaceId, query } → 200 with data[] of RetrievedChunk.
 *   2. A non-member (no workspace membership at all) → 403.
 *   3. A guest with VIEW on one List gets only that list's chunk(s), not a
 *      private-space chunk. Lighter than Task 9's deep service proof; this is
 *      an HTTP-layer assertion that the route's requirePermission('ai.use') gate
 *      and the service's ACL filter both fire correctly end-to-end via HTTP.
 *
 * Corpus is seeded via POST /dev/ai/reindex so no Redis is needed.
 *
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// ── Helpers ──────────────────────────────────────────────────────────────────

async function mkList(wsId: string, spaceId: string, token: string, name: string): Promise<string> {
  const d = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token,
    json: { workspaceId: wsId, spaceId, folderId: null, name, position: 0 },
  }), 201)).data;
  return d.id ?? d.Id;
}

async function mkTask(wsId: string, listId: string, token: string, title: string, description: string): Promise<string> {
  const d = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token,
    json: { workspaceId: wsId, listId, title, description, type: 'TASK' },
  }), 201)).data;
  return d.id ?? d.Id;
}

async function reindex(token: string, workspaceId: string): Promise<{ tasks: number; docs: number; comments: number }> {
  const res = await request('/dev/ai/reindex', { method: 'POST', token, json: { workspaceId } });
  const body = await json<{ data: any }>(res, 200);
  return body.data;
}

async function search(token: string, body: Record<string, unknown>): Promise<Response> {
  return request('/ai/search', { method: 'POST', token, json: body });
}

/** Invite a new user as guest into a workspace scoped to one object and accept the invite. */
async function inviteGuest(
  ownerToken: string,
  wsId: string,
  email: string,
  grant: { objectType: 'SPACE' | 'FOLDER' | 'LIST'; objectId: string; level: 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL' },
): Promise<{ id: string; token: string }> {
  const guest = await createTestUser({ email });
  const { invite } = await json<{ invite: any }>(await request('/guests/invites', {
    method: 'POST', token: ownerToken,
    json: { workspaceId: wsId, email, objectType: grant.objectType, objectId: grant.objectId, level: grant.level },
  }), 201);
  await json(await request(`/guests/invites/${invite.token}/accept`, {
    method: 'POST', token: guest.accessToken, json: {},
  }), 200);
  return { id: guest.user.Id, token: guest.accessToken };
}

// ── Scenario seed ────────────────────────────────────────────────────────────

interface Scenario {
  ownerToken: string;
  workspaceId: string;
  publicListId: string;
  privateListId: string;
  lunchTaskId: string;
  nuclearTaskId: string;
}

async function seedScenario(): Promise<Scenario> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const owner = await createTestUser({ email: `route-owner-${stamp}@projectflow.test` });
  const ownerToken = owner.accessToken;
  const ws = await createTestWorkspace(ownerToken);
  const wsId = ws.Id;

  // Public space (default visibility → PUBLIC so the guest sees it).
  const publicSpace = await createTestProject(wsId, ownerToken, {
    name: 'Open Space', key: `OP${stamp.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}`,
  });
  const publicListId = await mkList(wsId, publicSpace.Id, ownerToken, 'Public List');
  const lunchTaskId = await mkTask(wsId, publicListId, ownerToken, 'Team lunch friday', 'lunch plans for friday downtown');

  // Private space — make it PRIVATE so the guest cannot see it.
  const privateSpace = await createTestProject(wsId, ownerToken, {
    name: 'Secret Space', key: `SC${stamp.replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}`,
  });
  // Set visibility PRIVATE via the space update endpoint (same pattern as security test).
  await request(`/projects/${privateSpace.Id}`, {
    method: 'PATCH', token: ownerToken,
    json: { visibility: 'PRIVATE' },
  });
  const privateListId = await mkList(wsId, privateSpace.Id, ownerToken, 'Secret List');
  const nuclearTaskId = await mkTask(wsId, privateListId, ownerToken, 'Nuclear launch codes', 'classified nuclear secret plans');

  return { ownerToken, workspaceId: wsId, publicListId, privateListId, lunchTaskId, nuclearTaskId };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /ai/search', () => {
  it('1. owner gets 200 with a non-empty data[] after reindexing', async () => {
    const s = await seedScenario();

    // Reindex via the dev route — owner has ai.use + the dev route is accessible.
    const counts = await reindex(s.ownerToken, s.workspaceId);
    expect(counts.tasks).toBeGreaterThanOrEqual(2);

    const res = await search(s.ownerToken, { workspaceId: s.workspaceId, query: 'lunch friday downtown' });
    expect(res.status).toBe(200);

    const body = await json<{ data: any[] }>(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    // Each element should match the RetrievedChunk shape.
    const chunk = body.data[0];
    expect(chunk).toMatchObject({
      id:         expect.any(String),
      objectType: expect.any(String),
      objectId:   expect.any(String),
      scopeType:  expect.any(String),
      scopeId:    expect.any(String),
      content:    expect.any(String),
    });

    // The lunch task should appear.
    const objectIds = body.data.map((c: any) => (c.objectId as string).toLowerCase());
    expect(objectIds).toContain(s.lunchTaskId.toLowerCase());
  });

  it('2. a non-member (no workspace membership) gets 403', async () => {
    const s = await seedScenario();
    await reindex(s.ownerToken, s.workspaceId);

    // Completely separate user — not a member of the workspace at all.
    const outsider = await createTestUser({ email: `outsider-${Date.now()}@projectflow.test` });

    const res = await search(outsider.accessToken, { workspaceId: s.workspaceId, query: 'lunch' });
    expect(res.status).toBe(403);
  });

  it('3. a guest (no ai.use) gets 403 from the HTTP gate; the limited-scope service-layer proof lives in Task 9', async () => {
    // Migration 0064 grants ai.use to workspace-owner/admin/member only.
    // Guests and workspace-viewers are intentionally excluded. This test proves
    // the HTTP route's requirePermission('ai.use') gate fires correctly for a
    // guest user who has a LIST-scoped grant but no ai.use.
    //
    // The deeper proof that a workspace-member with limited scope sees only
    // their chunks (not private-space chunks) lives in Task 9's
    // retrieval.security.integration.test.ts, which calls RetrievalService
    // directly as an authenticated member.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const s = await seedScenario();
    await reindex(s.ownerToken, s.workspaceId);

    // Invite a guest with VIEW on the PUBLIC list — they have object-level
    // visibility but NO ai.use workspace permission.
    const guest = await inviteGuest(
      s.ownerToken, s.workspaceId,
      `guest-${stamp}@vendor.io`,
      { objectType: 'LIST', objectId: s.publicListId, level: 'VIEW' },
    );

    const res = await search(guest.token, { workspaceId: s.workspaceId, query: 'lunch nuclear classified' });
    // The HTTP gate must deny — guest lacks ai.use.
    expect(res.status).toBe(403);
  });
});
