/**
 * Regression coverage for the cache-bust fixes:
 *   - bbd9228 — task writes bust /epics + /roadmap + /sprints
 *   - 9c0215c — workspace + project writes bust /workspaces + /projects
 *
 * The bug they fixed: GET responses are cached in Redis with TTLs from
 * 30s (workspaces, projects) up to 5 min (epics). Without busting on
 * write, a freshly-created EPIC stayed invisible on the Epics page until
 * the TTL expired and the user navigated away long enough to retry.
 * This file proves the cache key is invalidated on every relevant write.
 *
 * The Redis response cache adds an `x-cache: HIT|MISS` header — we
 * assert against that header rather than poking Redis directly so the
 * test stays at the routing boundary.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from './setup/testServer.js';
import { truncateAll } from './fixtures/truncate.js';
import {
  createTestUser,
  createTestWorkspace,
  createTestProject,
} from './fixtures/factories.js';
import { closePool } from '../shared/lib/db.js';
import { cacheDelPattern } from '../shared/lib/cache.js';

beforeEach(async () => {
  await truncateAll();
  // The cache lives in real Redis (no namespace separation between dev
  // and test), so wipe the http cache namespace too. Otherwise a key
  // left over from a prior test run can mask a missing bust.
  await cacheDelPattern('http:*');
});
afterAll(async () => { await closePool(); });

function xCache(res: Response): string | null {
  return res.headers.get('x-cache');
}

describe('cache invalidation — /epics on task write (bbd9228)', () => {
  it('POST /tasks of type=EPIC busts the warm /epics cache', async () => {
    const owner = await createTestUser({ email: 'cache-epic@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);
    const prj   = await createTestProject(ws.Id, owner.accessToken);

    // Cold MISS populates cache with [].
    const cold = await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    expect(cold.status).toBe(200);
    expect(xCache(cold)).toBe('MISS');

    // Warm HIT confirms the cache is functioning.
    const warm = await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    expect(xCache(warm)).toBe('HIT');

    // Create an EPIC — must bust the cache.
    const create = await request('/tasks', {
      method: 'POST',
      token:  owner.accessToken,
      json:   { workspaceId: ws.Id, projectId: prj.Id, title: 'Bust me', type: 'EPIC' },
    });
    expect(create.status).toBe(201);

    // Next read MUST be a MISS and MUST include the new epic.
    const after = await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    expect(xCache(after)).toBe('MISS');
    const body = await json<{ epics: { title: string }[] }>(after, 200);
    expect(body.epics.map((e) => e.title)).toContain('Bust me');
  });

  it('PATCH /tasks/:id of an EPIC busts the cache (rename appears immediately)', async () => {
    const owner = await createTestUser({ email: 'cache-patch@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);
    const prj   = await createTestProject(ws.Id, owner.accessToken);

    const create = await request('/tasks', {
      method: 'POST',
      token:  owner.accessToken,
      json:   { workspaceId: ws.Id, projectId: prj.Id, title: 'Original', type: 'EPIC' },
    });
    const created = await json<{ data: { Id: string } }>(create, 201);

    // Warm cache with the original title.
    await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    const hit = await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    expect(xCache(hit)).toBe('HIT');

    // Rename, then read.
    await request(`/tasks/${created.data.Id}`, {
      method: 'PATCH',
      token:  owner.accessToken,
      json:   { title: 'Renamed' },
    });

    const after = await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    expect(xCache(after)).toBe('MISS');
    const body = await json<{ epics: { title: string }[] }>(after, 200);
    expect(body.epics.map((e) => e.title)).toContain('Renamed');
  });

  it('DELETE /tasks/:id of an EPIC busts the cache (epic disappears immediately)', async () => {
    const owner = await createTestUser({ email: 'cache-del@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);
    const prj   = await createTestProject(ws.Id, owner.accessToken);

    const create = await request('/tasks', {
      method: 'POST',
      token:  owner.accessToken,
      json:   { workspaceId: ws.Id, projectId: prj.Id, title: 'To delete', type: 'EPIC' },
    });
    const created = await json<{ data: { Id: string } }>(create, 201);

    // Warm cache with the epic visible.
    await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    const hit = await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    expect(xCache(hit)).toBe('HIT');

    await request(`/tasks/${created.data.Id}`, {
      method: 'DELETE',
      token:  owner.accessToken,
    });

    const after = await request(`/epics?projectId=${prj.Id}`, { token: owner.accessToken });
    expect(xCache(after)).toBe('MISS');
    const body = await json<{ epics: { title: string }[] }>(after, 200);
    expect(body.epics.map((e) => e.title)).not.toContain('To delete');
  });
});

describe('cache invalidation — /workspaces on workspace write (9c0215c)', () => {
  it('POST /workspaces busts the warm /workspaces list cache', async () => {
    const owner = await createTestUser({ email: 'cache-ws@projectflow.test' });

    // Cold MISS — warm cache with the empty list.
    const cold = await request('/workspaces', { token: owner.accessToken });
    expect(xCache(cold)).toBe('MISS');
    const warm = await request('/workspaces', { token: owner.accessToken });
    expect(xCache(warm)).toBe('HIT');

    // Create a workspace.
    await createTestWorkspace(owner.accessToken, 'Bust me WS');

    // Next read MUST be MISS and MUST include the new row.
    const after = await request('/workspaces', { token: owner.accessToken });
    expect(xCache(after)).toBe('MISS');
    const body = await json<{ data: { Name: string }[] }>(after, 200);
    expect(body.data.map((w) => w.Name)).toContain('Bust me WS');
  });

  it('DELETE /workspaces/:id busts the cache (soft-deleted ws disappears immediately)', async () => {
    const owner = await createTestUser({ email: 'cache-ws-del@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken, 'Doomed');

    // Warm.
    await request('/workspaces', { token: owner.accessToken });
    const hit = await request('/workspaces', { token: owner.accessToken });
    expect(xCache(hit)).toBe('HIT');

    await request(`/workspaces/${ws.Id}`, { method: 'DELETE', token: owner.accessToken });

    const after = await request('/workspaces', { token: owner.accessToken });
    expect(xCache(after)).toBe('MISS');
    const body = await json<{ data: { Id: string }[] }>(after, 200);
    expect(body.data.some((w) => w.Id === ws.Id)).toBe(false);
  });
});

describe('cache invalidation — /projects on project write (9c0215c)', () => {
  it('POST /projects busts the warm /projects list cache', async () => {
    const owner = await createTestUser({ email: 'cache-prj@projectflow.test' });
    const ws    = await createTestWorkspace(owner.accessToken);

    const cold = await request(`/projects?workspaceId=${ws.Id}`, { token: owner.accessToken });
    expect(xCache(cold)).toBe('MISS');
    const warm = await request(`/projects?workspaceId=${ws.Id}`, { token: owner.accessToken });
    expect(xCache(warm)).toBe('HIT');

    await createTestProject(ws.Id, owner.accessToken, { name: 'New Project' });

    const after = await request(`/projects?workspaceId=${ws.Id}`, { token: owner.accessToken });
    expect(xCache(after)).toBe('MISS');
    const body = await json<{ data: { Name: string }[] }>(after, 200);
    expect(body.data.map((p) => p.Name)).toContain('New Project');
  });
});
