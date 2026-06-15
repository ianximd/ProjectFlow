/**
 * Phase 10d — resolver-level guest invariant. Proves usp_ObjectAccess_Resolve
 * gives a guest NO floor: VIEW on the one granted List, NULL (Found=true) on
 * the Space + sibling List, so the tree is invisible by construction.
 * DB SAFETY: local Docker ProjectFlow_Test only.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { accessService } from '../access.service.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

describe('resolver: guest contributes no floor', () => {
  it('guest with one List grant resolves VIEW there, NULL on the Space + sibling', async () => {
    const owner = await createTestUser({ email: `gr-owner-${Date.now()}@projectflow.test` });
    const t = owner.accessToken;
    const ws = await createTestWorkspace(t);
    const space = await createTestProject(ws.Id, t, { name: 'GR', key: `GR${Date.now() % 100000}` });
    const mk = async (name: string) => {
      const res = await request('/lists', { method: 'POST', token: t, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name, position: 0 } });
      const d = (await json<{ data: any }>(res, 201)).data;
      return { ...d, id: d.id ?? d.Id }; // list row is PascalCase Id
    };
    const granted = await mk('Granted');
    const other   = await mk('Other');

    const guestEmail = `gr-ext-${Date.now()}@vendor.io`;
    const guest = await createTestUser({ email: guestEmail });
    const { invite } = await json<{ invite: any }>(await request('/guests/invites', {
      method: 'POST', token: t,
      json: { workspaceId: ws.Id, email: guestEmail, objectType: 'LIST', objectId: granted.id, level: 'VIEW' },
    }), 201);
    await json(await request(`/guests/invites/${invite.token}/accept`, { method: 'POST', token: guest.accessToken, json: {} }), 200);

    // Resolver is the source of truth.
    const onGranted = await accessService.resolveOrNull(guest.user.Id, 'LIST', granted.id);
    expect(onGranted.level).toBe('VIEW');
    expect(onGranted.found).toBe(true);

    const onSibling = await accessService.resolveOrNull(guest.user.Id, 'LIST', other.id);
    expect(onSibling.level).toBeNull();      // no floor, no grant
    expect(onSibling.found).toBe(true);      // object exists → 403, not 404

    const onSpace = await accessService.resolveOrNull(guest.user.Id, 'SPACE', space.Id);
    expect(onSpace.level).toBeNull();        // the Space itself is invisible
    expect(onSpace.found).toBe(true);
  });

  it('a FULL member (owner) still resolves the FULL floor (no regression)', async () => {
    const owner = await createTestUser({ email: `gr-m-${Date.now()}@projectflow.test` });
    const ws = await createTestWorkspace(owner.accessToken);
    const space = await createTestProject(ws.Id, owner.accessToken, { name: 'M', key: `M${Date.now() % 100000}` });
    const r = await accessService.resolveOrNull(owner.user.Id, 'SPACE', space.Id);
    expect(r.level).toBe('FULL');
  });
});
