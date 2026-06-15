/**
 * Phase 10b — Object-permission editor + most-specific-wins override.
 * A List-level EDIT grant overrides a Space-level VIEW for the same subject.
 * DB SAFETY: targets local Docker ProjectFlow_Test.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { accessService } from '../access.service.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

async function seedSpaceAndList(token: string, wsId: string) {
  const space = await createTestProject(wsId, token, { name: 'ACL Space', key: `ACL${Date.now() % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: wsId, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  return { spaceId: space.Id, listId: list.id ?? list.Id };
}

describe('object permission most-specific-wins', () => {
  it('a List-level EDIT grant overrides a Space-level VIEW for the same user', async () => {
    const owner = await createTestUser({ email: `op-owner-${Date.now()}@projectflow.test` });
    const guest = await createTestUser({ email: `op-guest-${Date.now()}@projectflow.test` }); // non-member of ws
    const ws = await createTestWorkspace(owner.accessToken);
    const { spaceId, listId } = await seedSpaceAndList(owner.accessToken, ws.Id);

    // Space VIEW → the guest can VIEW the space (and inherit VIEW on the list)...
    await accessService.setObjectPermission({
      workspaceId: ws.Id, subjectType: 'USER', subjectId: guest.user.Id,
      objectType: 'SPACE', objectId: spaceId, level: 'VIEW', actorId: owner.user.Id,
    });
    expect((await accessService.resolveOrNull(guest.user.Id, 'LIST', listId)).level).toBe('VIEW');

    // ...until a List-level EDIT grant wins for the list specifically.
    await accessService.setObjectPermission({
      workspaceId: ws.Id, subjectType: 'USER', subjectId: guest.user.Id,
      objectType: 'LIST', objectId: listId, level: 'EDIT', actorId: owner.user.Id,
    });
    expect((await accessService.resolveOrNull(guest.user.Id, 'LIST', listId)).level).toBe('EDIT');
    // The space itself stays VIEW (the list grant is more specific, not global).
    expect((await accessService.resolveOrNull(guest.user.Id, 'SPACE', spaceId)).level).toBe('VIEW');
  });

  it('listObjectPermissions returns both the own grant and the inherited ancestor grant', async () => {
    const owner = await createTestUser({ email: `op-list-${Date.now()}@projectflow.test` });
    const guest = await createTestUser({ email: `op-list-g-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const { spaceId, listId } = await seedSpaceAndList(owner.accessToken, ws.Id);

    await accessService.setObjectPermission({ workspaceId: ws.Id, subjectType: 'USER', subjectId: guest.user.Id, objectType: 'SPACE', objectId: spaceId, level: 'VIEW', actorId: owner.user.Id });
    await accessService.setObjectPermission({ workspaceId: ws.Id, subjectType: 'USER', subjectId: guest.user.Id, objectType: 'LIST', objectId: listId, level: 'EDIT', actorId: owner.user.Id });

    const grants = await accessService.listObjectPermissions('LIST', listId);
    const own       = grants.find((g) => g.objectType === 'LIST'  && g.subjectId === guest.user.Id);
    const inherited = grants.find((g) => g.objectType === 'SPACE' && g.subjectId === guest.user.Id);
    expect(own?.level).toBe('EDIT');
    expect(own?.inherited).toBe(false);
    expect(inherited?.level).toBe('VIEW');
    expect(inherited?.inherited).toBe(true);
    expect(inherited?.inheritedFromName).toBe('ACL Space');
  });

  it('REST: PUT then DELETE a grant via the FULL-gated editor surface', async () => {
    const owner = await createTestUser({ email: `op-rest-${Date.now()}@projectflow.test` });
    const guest = await createTestUser({ email: `op-rest-g-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const token = owner.accessToken;
    const { listId } = await seedSpaceAndList(token, ws.Id);

    const put = await json<{ data: any[] }>(await request(`/access/LIST/${listId}/permissions`, {
      method: 'PUT', token, json: { subjectType: 'USER', subjectId: guest.user.Id, level: 'EDIT' },
    }));
    expect(put.data.some((g) => g.subjectId === guest.user.Id && g.level === 'EDIT')).toBe(true);

    const del = await json<{ data: any[] }>(await request(`/access/LIST/${listId}/permissions`, {
      method: 'DELETE', token, json: { subjectType: 'USER', subjectId: guest.user.Id },
    }));
    expect(del.data.some((g) => g.subjectId === guest.user.Id)).toBe(false);
  });
});
