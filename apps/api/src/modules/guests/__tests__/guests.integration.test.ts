/**
 * Phase 10d — Guests & Limited Members integration coverage.
 * A guest sees ONLY explicitly-shared items, cannot enumerate the Space tree,
 * and an org-email invite becomes a limited member (not a guest).
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedSpaceWithTwoLists() {
  const owner = await createTestUser({ email: `g-owner-${Date.now()}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'GSpace', key: `GS${Date.now() % 100000}` });
  const mk = async (name: string) => {
    const res = await request('/lists', { method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name, position: 0 } });
    const d = (await json<{ data: any }>(res, 201)).data;
    return { ...d, id: d.id ?? d.Id }; // list row is PascalCase Id
  };
  const listA = await mk('Shared List');
  const listB = await mk('Hidden List');
  return { owner, token, wsId: ws.Id, spaceId: space.Id, listA, listB };
}

describe('guests', () => {
  it('invite (external) → accept → guest sees the granted List only, 403s the Space + sibling', async () => {
    const { token, wsId, spaceId, listA, listB } = await seedSpaceWithTwoLists();
    const guestEmail = `ext-${Date.now()}@vendor.io`; // not the workspace org domain
    const guest = await createTestUser({ email: guestEmail });

    const { invite } = await json<{ invite: any }>(await request('/guests/invites', {
      method: 'POST', token,
      json: { workspaceId: wsId, email: guestEmail, objectType: 'LIST', objectId: listA.id, level: 'VIEW' },
    }), 201);
    expect(invite.status).toBe('pending');

    await json(await request(`/guests/invites/${invite.token}/accept`, { method: 'POST', token: guest.accessToken, json: {} }), 200);

    // Owner (full member) still sees BOTH lists — the filter is a no-op for them.
    const ownerLists = await json<{ data: any[] }>(await request(`/lists?spaceId=${spaceId}`, { token }), 200);
    expect(ownerLists.data.length).toBe(2);

    // Granted List → 200 for the guest.
    const okList = await request(`/lists/${listA.id}/effective-statuses`, { token: guest.accessToken });
    expect(okList.status).toBe(200);

    // Sibling List → 403 (exists, no grant — resolver floor=none).
    const sibling = await request(`/lists/${listB.id}/effective-statuses`, { token: guest.accessToken });
    expect(sibling.status).toBe(403);

    // The Space tree is invisible: folder/list listings under the Space are gated 403.
    const spaceLists = await request(`/lists?spaceId=${spaceId}`, { token: guest.accessToken });
    expect(spaceLists.status).toBe(403);
    const spaceFolders = await request(`/folders?spaceId=${spaceId}`, { token: guest.accessToken });
    expect(spaceFolders.status).toBe(403);
  });

  it('org-email invite becomes a LIMITED MEMBER, not a guest', async () => {
    const { token, wsId, listA } = await seedSpaceWithTwoLists();
    // Set the workspace verified domain to the invitee's domain.
    await json(await request(`/workspaces/${wsId}`, { method: 'PATCH', token, json: { verifiedDomain: 'orgmail.test' } }), 200);

    const body = await json<{ invite: any; role: string }>(await request('/guests/invites', {
      method: 'POST', token,
      json: { workspaceId: wsId, email: `staff-${Date.now()}@orgmail.test`, objectType: 'LIST', objectId: listA.id, level: 'VIEW' },
    }), 201);
    expect(body.role).toBe('workspace-limited-member');
    expect(body.invite.status).toBe('pending');
  });

  it('rejects a GUEST invite at SPACE scope (external email)', async () => {
    const { token, wsId, spaceId } = await seedSpaceWithTwoLists();
    const res = await request('/guests/invites', {
      method: 'POST', token,
      json: { workspaceId: wsId, email: `ext2-${Date.now()}@vendor.io`, objectType: 'SPACE', objectId: spaceId, level: 'VIEW' },
    });
    expect(res.status).toBe(422);
  });
});
