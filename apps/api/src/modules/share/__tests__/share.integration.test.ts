/**
 * Phase 10c — Public Share Links + Request Access integration coverage.
 * Exercises the share + access-request SPs/REST against the REAL SQL stack.
 * DB SAFETY: targets local Docker ProjectFlow_Test only.
 *
 * SECURITY FOCUS (spec §6.5): a share token grants access to EXACTLY one object,
 * read-only, with NO auth, NO workspace context, NO parent/sibling navigation.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

// /tasks + /lists both return `{ data: <row> }`; rows may be PascalCase.
const idOf = (r: any): string => String(r.id ?? r.Id);
const lc = (s: string): string => s.toLowerCase();

async function seedTask() {
  const owner = await createTestUser();
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Share Space' });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'L', position: 0 },
  }), 201)).data;
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token, json: { projectId: space.Id, workspaceId: ws.Id, title: 'Secret task', listId: idOf(list) },
  }), 201)).data;
  return { owner, token, ws, space, list, task, listId: idOf(list), taskId: idOf(task) };
}

describe('public share links', () => {
  it('serves EXACTLY the one shared object, read-only, with NO auth and NO tree access', async () => {
    const { token, taskId } = await seedTask();

    const link = (await json<{ link: any }>(await request('/share', {
      method: 'POST', token, json: { objectType: 'task', objectId: taskId },
    }), 201)).link;
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(link.level).toBe('VIEW');

    // Resolve UNAUTHENTICATED — NO Authorization header.
    const projection = (await json<{ projection: any }>(await request(`/public/share/${link.token}`))).projection;
    expect(projection.objectType).toBe('task');
    expect(lc(projection.objectId)).toBe(lc(taskId));
    expect(projection.title).toBe('Secret task');
    expect(projection.level).toBe('VIEW');
    // Navigation + writes are stripped — no path up the tree, no edit affordances.
    expect(projection.data).not.toHaveProperty('listId');
    expect(projection.data).not.toHaveProperty('parentTaskId');
    expect(projection.data).not.toHaveProperty('workspaceId');
    expect(projection.data).not.toHaveProperty('assignees');
    expect(projection.data).not.toHaveProperty('editUrl');
  });

  it('a revoked token 404s on the public route', async () => {
    const { token, taskId } = await seedTask();
    const link = (await json<{ link: any }>(await request('/share', {
      method: 'POST', token, json: { objectType: 'task', objectId: taskId },
    }), 201)).link;
    const del = await request(`/share/${link.id}`, { method: 'DELETE', token });
    expect(del.status).toBe(200);
    const res = await request(`/public/share/${link.token}`);
    expect(res.status).toBe(404);
  });

  it('an expired token 404s on the public route', async () => {
    const { token, taskId } = await seedTask();
    const past = new Date(Date.now() - 60_000).toISOString();
    const link = (await json<{ link: any }>(await request('/share', {
      method: 'POST', token, json: { objectType: 'task', objectId: taskId, expiresAt: past },
    }), 201)).link;
    const res = await request(`/public/share/${link.token}`);
    expect(res.status).toBe(404);
  });

  it('an unknown token 404s', async () => {
    const res = await request('/public/share/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(res.status).toBe(404);
  });

  it('a non-FULL user cannot create a share link', async () => {
    const { taskId } = await seedTask();
    const stranger = await createTestUser();
    const res = await request('/share', {
      method: 'POST', token: stranger.accessToken, json: { objectType: 'task', objectId: taskId },
    });
    expect([403, 404]).toContain(res.status);   // fail-closed (no share.create / no FULL / unresolvable)
  });
});

describe('request access', () => {
  it('creates a notification to owners/admins, and granting writes an ObjectPermissions row reachable by the requester', async () => {
    const { owner, listId, taskId } = await seedTask();
    const requester = await createTestUser();

    // Requester asks for access.
    const req = (await json<{ request: any }>(await request('/access/request', {
      method: 'POST', token: requester.accessToken, json: { objectType: 'task', objectId: taskId, note: 'please' },
    }), 201)).request;
    expect(req.status).toBe('pending');

    // The owner received an ACCESS_REQUESTED notification.
    const notifs = (await json<{ data: any[] }>(await request('/notifications?pageSize=20', { token: owner.accessToken }))).data;
    expect((notifs ?? []).some((n: any) => n.type === 'ACCESS_REQUESTED')).toBe(true);

    // Owner (FULL) grants EDIT → ObjectPermissions row lands on the task's List.
    const resolved = (await json<{ request: any }>(await request(`/access/request/${req.id}/resolve`, {
      method: 'POST', token: owner.accessToken, json: { decision: 'granted', level: 'EDIT' },
    }), 200)).request;
    expect(resolved.status).toBe('granted');

    // The grant landed as an ObjectPermissions row on the task's List (10b
    // primitive) — visible to the owner via the 10b per-object permission list.
    const perms = (await json<{ data: any[] }>(await request(`/access/LIST/${listId}/permissions`, { token: owner.accessToken }))).data;
    expect(perms.some((g: any) => g.subjectType === 'USER' && lc(g.subjectId) === lc(requester.user.Id) && g.level === 'EDIT')).toBe(true);
  });

  it('resolving as a non-FULL user is rejected and writes NO grant', async () => {
    const { owner, listId, taskId } = await seedTask();
    const requester = await createTestUser();
    const stranger  = await createTestUser();
    const req = (await json<{ request: any }>(await request('/access/request', {
      method: 'POST', token: requester.accessToken, json: { objectType: 'task', objectId: taskId },
    }), 201)).request;
    const res = await request(`/access/request/${req.id}/resolve`, {
      method: 'POST', token: stranger.accessToken, json: { decision: 'granted', level: 'EDIT' },
    });
    expect([403, 404]).toContain(res.status);
    // No grant written: the owner's per-object permission list has no USER grant
    // for the requester.
    const perms = (await json<{ data: any[] }>(await request(`/access/LIST/${listId}/permissions`, { token: owner.accessToken }))).data;
    expect(perms.some((g: any) => g.subjectType === 'USER' && lc(g.subjectId) === lc(requester.user.Id))).toBe(false);
  });

  it('a denied request cannot be flipped to granted via a stale id (no grant written)', async () => {
    const { owner, listId, taskId } = await seedTask();
    const requester = await createTestUser();
    const req = (await json<{ request: any }>(await request('/access/request', {
      method: 'POST', token: requester.accessToken, json: { objectType: 'task', objectId: taskId },
    }), 201)).request;

    // Owner denies.
    const denied = (await json<{ request: any }>(await request(`/access/request/${req.id}/resolve`, {
      method: 'POST', token: owner.accessToken, json: { decision: 'denied' },
    }), 200)).request;
    expect(denied.status).toBe('denied');

    // Re-resolve the same (now non-pending) id as 'granted' → 404, no transition.
    const flip = await request(`/access/request/${req.id}/resolve`, {
      method: 'POST', token: owner.accessToken, json: { decision: 'granted', level: 'EDIT' },
    });
    expect(flip.status).toBe(404);

    // No grant leaked: the owner's per-object permission list has no USER grant
    // for the (denied) requester.
    const perms = (await json<{ data: any[] }>(await request(`/access/LIST/${listId}/permissions`, { token: owner.accessToken }))).data;
    expect(perms.some((g: any) => g.subjectType === 'USER' && lc(g.subjectId) === lc(requester.user.Id))).toBe(false);
  });
});
