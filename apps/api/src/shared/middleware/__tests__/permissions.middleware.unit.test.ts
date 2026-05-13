import { beforeEach, describe, expect, it, vi } from 'vitest';

// roleService is a module singleton — every permissions check resolves
// through it. Mock at module scope so we can drive the user's slug set
// per test.
vi.mock('../../../modules/roles/role.service.js', () => ({
  roleService: {
    getUserPermissionSlugs: vi.fn(async (_userId: string, _wsId: string | null) => new Set<string>()),
  },
}));

// Freeze guard hits WorkspaceRepository.getStatus() — mock the class so
// each test can declare the workspace's current Status/DeletedAt without
// touching the DB. vi.hoisted keeps the map alive across the hoisted mock.
const mocks = vi.hoisted(() => ({
  statuses: new Map<string, { Id: string; Status: string; DeletedAt: Date | null }>(),
  getStatusSpy: vi.fn<(id: string) => Promise<{ Id: string; Status: string; DeletedAt: Date | null } | null>>(),
}));
vi.mock('../../../modules/workspaces/workspace.repository.js', () => ({
  WorkspaceRepository: class {
    async getStatus(id: string) {
      mocks.getStatusSpy(id);
      return mocks.statuses.get(id) ?? null;
    }
  },
}));

const { requirePermission, loadPermissions } = await import('../permissions.middleware.js');
const { roleService }                        = await import('../../../modules/roles/role.service.js');

// ─── Hono Context shim ──────────────────────────────────────────────────────
// The middleware only touches: c.get/set, c.req.param, c.req.query, c.json.
// A real Hono app would work too but adds router boilerplate per case;
// this shim makes branch coverage cheap to read.
interface ShimOpts {
  userId?:        string | null;
  pathParams?:    Record<string, string>;
  queryParams?:   Record<string, string>;
  method?:        string;
  path?:          string;
}
function makeContext(o: ShimOpts = {}) {
  const state = new Map<string, unknown>();
  if (o.userId !== null) state.set('user', { userId: o.userId ?? 'user-1' });

  const responses: { body: unknown; status: number }[] = [];

  return {
    get:  (k: string) => state.get(k),
    set:  (k: string, v: unknown) => { state.set(k, v); },
    json: (body: unknown, status: number) => {
      responses.push({ body, status });
      return { __response: true, body, status } as any;
    },
    req: {
      param:  (name: string) => o.pathParams?.[name],
      query:  (name: string) => o.queryParams?.[name],
      method: o.method ?? 'GET',
      path:   o.path   ?? '/',
    },
    // Test helpers
    _responses: () => responses,
    _state:     state,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.statuses.clear();
});

// ─── unauth ─────────────────────────────────────────────────────────────────

describe('requirePermission — auth gate', () => {
  it('returns 401 when no user is on the context', async () => {
    const c    = makeContext({ userId: null });
    const next = vi.fn();

    await requirePermission('task.create')(c, next);

    expect(c._responses()[0]?.status).toBe(401);
    expect(c._responses()[0]?.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    expect(next).not.toHaveBeenCalled();
    // Critical: the slug lookup must not happen for unauth — that would
    // leak the existence of permission slugs through timing.
    expect(roleService.getUserPermissionSlugs).not.toHaveBeenCalled();
  });
});

// ─── single slug ────────────────────────────────────────────────────────────

describe('requirePermission — single slug', () => {
  it('passes through when the user holds the slug', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.create']));
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission('task.create')(c, next);

    expect(next).toHaveBeenCalledOnce();
    expect(c._responses()).toHaveLength(0);
  });

  it('denies with 403 + slug-named message when the user lacks the slug', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set([]));
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission('task.create')(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    expect(c._responses()[0]?.body).toMatchObject({
      error: { code: 'FORBIDDEN', message: expect.stringContaining("'task.create'") },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── any-of slug array ──────────────────────────────────────────────────────

describe('requirePermission — any-of slug array', () => {
  it('passes when the user holds at least one slug', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['admin.workspaces.delete']));
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission(['workspace.delete', 'admin.workspaces.delete'])(c, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('denies with a multi-slug message when none match', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['unrelated']));
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission(['workspace.delete', 'admin.workspaces.delete'])(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    expect(c._responses()[0]?.body).toMatchObject({
      error: { message: expect.stringContaining('any of:') },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── workspace resolution ───────────────────────────────────────────────────

describe('requirePermission — workspace resolution', () => {
  it('reads workspaceId from a path param', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['workspace.update']));
    const c    = makeContext({ pathParams: { id: 'ws-42' } });
    const next = vi.fn();

    await requirePermission('workspace.update', { workspaceParam: 'id' })(c, next);

    expect(next).toHaveBeenCalledOnce();
    expect(roleService.getUserPermissionSlugs).toHaveBeenCalledWith('user-1', 'ws-42');
  });

  it('reads workspaceId from a query param when path param is absent', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['workspace.update']));
    const c    = makeContext({ queryParams: { workspaceId: 'ws-from-query' } });
    const next = vi.fn();

    await requirePermission('workspace.update', { workspaceParam: 'workspaceId' })(c, next);

    expect(roleService.getUserPermissionSlugs).toHaveBeenCalledWith('user-1', 'ws-from-query');
  });

  it('caches resolveWorkspace across two consecutive gates on the same context', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.update', 'task.delete']));
    const resolve = vi.fn().mockResolvedValue('ws-resolved');
    const c       = makeContext();

    const next1 = vi.fn();
    await requirePermission('task.update', { resolveWorkspace: resolve })(c, next1);
    const next2 = vi.fn();
    await requirePermission('task.delete', { resolveWorkspace: resolve })(c, next2);

    expect(next1).toHaveBeenCalledOnce();
    expect(next2).toHaveBeenCalledOnce();
    // The expensive lookup runs ONCE — the second gate hits the context cache.
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('returns 404 when resolveWorkspace returns null (resource missing)', async () => {
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission('task.update', {
      resolveWorkspace: vi.fn().mockResolvedValue(null),
    })(c, next);

    expect(c._responses()[0]?.status).toBe(404);
    expect(c._responses()[0]?.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(roleService.getUserPermissionSlugs).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── ownerOnly ──────────────────────────────────────────────────────────────

describe('requirePermission — ownerOnly', () => {
  it('passes when the user holds the slug AND is the owner', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['comment.update.own']));
    const c    = makeContext({ userId: 'user-1' });
    const next = vi.fn();

    await requirePermission('comment.update.own', {
      ownerOnly: vi.fn().mockResolvedValue('user-1'),
    })(c, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('denies (403) when the user holds the slug but is NOT the owner', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['comment.update.own']));
    const c    = makeContext({ userId: 'user-1' });
    const next = vi.fn();

    await requirePermission('comment.update.own', {
      ownerOnly: vi.fn().mockResolvedValue('different-user'),
    })(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the resource is missing (resolveOwner → null)', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['comment.update.own']));
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission('comment.update.own', {
      ownerOnly: vi.fn().mockResolvedValue(null),
    })(c, next);

    expect(c._responses()[0]?.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('skips the owner check when the user lacks the primary slug — 403 short-circuit', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set([]));
    const ownerResolver = vi.fn();
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission('comment.update.own', { ownerOnly: ownerResolver })(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    // The owner resolver is an SP call — we must not pay for it when the
    // primary check has already failed.
    expect(ownerResolver).not.toHaveBeenCalled();
  });
});

// ─── ownerFallback ──────────────────────────────────────────────────────────

describe('requirePermission — ownerFallback', () => {
  it('passes purely on the primary slug — no fallback resolver call', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['comment.delete.any']));
    const fallbackOwner = vi.fn();
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission('comment.delete.any', {
      ownerFallback: { slug: 'comment.delete.own', resolveOwner: fallbackOwner },
    })(c, next);

    expect(next).toHaveBeenCalledOnce();
    // The whole point of "fallback": skip the lookup when the primary is sufficient.
    expect(fallbackOwner).not.toHaveBeenCalled();
  });

  it('passes via fallback when the user lacks primary, has fallback slug, AND is owner', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['comment.delete.own']));
    const c    = makeContext({ userId: 'user-1' });
    const next = vi.fn();

    await requirePermission('comment.delete.any', {
      ownerFallback: {
        slug:         'comment.delete.own',
        resolveOwner: vi.fn().mockResolvedValue('user-1'),
      },
    })(c, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('denies when user has fallback slug but is NOT the owner', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['comment.delete.own']));
    const c    = makeContext({ userId: 'user-1' });
    const next = vi.fn();

    await requirePermission('comment.delete.any', {
      ownerFallback: {
        slug:         'comment.delete.own',
        resolveOwner: vi.fn().mockResolvedValue('different-user'),
      },
    })(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('denies when user has neither primary nor fallback slug', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set([]));
    const fallbackOwner = vi.fn();
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission('comment.delete.any', {
      ownerFallback: { slug: 'comment.delete.own', resolveOwner: fallbackOwner },
    })(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    expect(fallbackOwner).not.toHaveBeenCalled();
  });

  it('returns 404 when fallback owner resolver returns null', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['comment.delete.own']));
    const c    = makeContext();
    const next = vi.fn();

    await requirePermission('comment.delete.any', {
      ownerFallback: {
        slug:         'comment.delete.own',
        resolveOwner: vi.fn().mockResolvedValue(null),
      },
    })(c, next);

    expect(c._responses()[0]?.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── loadPermissions caching ────────────────────────────────────────────────

describe('loadPermissions', () => {
  it('caches per-(workspace) on the Hono context', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['x']));
    const c = makeContext();

    const a = await loadPermissions(c, 'ws-1');
    const b = await loadPermissions(c, 'ws-1');

    expect(a).toBe(b);
    expect(roleService.getUserPermissionSlugs).toHaveBeenCalledOnce();
  });

  it('queries again for a different workspace id', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['x']));
    const c = makeContext();

    await loadPermissions(c, 'ws-1');
    await loadPermissions(c, 'ws-2');

    expect(roleService.getUserPermissionSlugs).toHaveBeenCalledTimes(2);
  });

  it('returns an empty set when there is no user on the context', async () => {
    const c = makeContext({ userId: null });

    const result = await loadPermissions(c, 'ws-1');

    expect(result.size).toBe(0);
    expect(roleService.getUserPermissionSlugs).not.toHaveBeenCalled();
  });
});

// ─── freeze guard ───────────────────────────────────────────────────────────
// Phase 6 W43. Even with the right slug, mutating requests against a FROZEN
// or SUSPENDED workspace must fail closed. The check is method-aware
// (writes only) and lets admins through so they can unfreeze.

describe('requirePermission — freeze guard', () => {
  it('blocks a POST to a FROZEN workspace with 403 WORKSPACE_FROZEN', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.create']));
    mocks.statuses.set('ws-frozen', { Id: 'ws-frozen', Status: 'FROZEN', DeletedAt: null });
    const c    = makeContext({ pathParams: { id: 'ws-frozen' }, method: 'POST' });
    const next = vi.fn();

    await requirePermission('task.create', { workspaceParam: 'id' })(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    expect(c._responses()[0]?.body).toMatchObject({ error: { code: 'WORKSPACE_FROZEN' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks a DELETE to a SUSPENDED workspace with 403 WORKSPACE_SUSPENDED', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.delete']));
    mocks.statuses.set('ws-susp', { Id: 'ws-susp', Status: 'SUSPENDED', DeletedAt: null });
    const c    = makeContext({ pathParams: { id: 'ws-susp' }, method: 'DELETE' });
    const next = vi.fn();

    await requirePermission('task.delete', { workspaceParam: 'id' })(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    expect(c._responses()[0]?.body).toMatchObject({ error: { code: 'WORKSPACE_SUSPENDED' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a GET against a FROZEN workspace — reads stay open', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.read']));
    mocks.statuses.set('ws-frozen', { Id: 'ws-frozen', Status: 'FROZEN', DeletedAt: null });
    const c    = makeContext({ pathParams: { id: 'ws-frozen' }, method: 'GET' });
    const next = vi.fn();

    await requirePermission('task.read', { workspaceParam: 'id' })(c, next);

    expect(next).toHaveBeenCalledOnce();
    // Avoid the SP entirely for reads — keeps the hot path cheap.
    expect(mocks.getStatusSpy).not.toHaveBeenCalled();
  });

  it('allows a POST against an ACTIVE workspace', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.create']));
    mocks.statuses.set('ws-1', { Id: 'ws-1', Status: 'ACTIVE', DeletedAt: null });
    const c    = makeContext({ pathParams: { id: 'ws-1' }, method: 'POST' });
    const next = vi.fn();

    await requirePermission('task.create', { workspaceParam: 'id' })(c, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows a POST against a TRIAL workspace', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.create']));
    mocks.statuses.set('ws-trial', { Id: 'ws-trial', Status: 'TRIAL', DeletedAt: null });
    const c    = makeContext({ pathParams: { id: 'ws-trial' }, method: 'POST' });
    const next = vi.fn();

    await requirePermission('task.create', { workspaceParam: 'id' })(c, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('lets an admin (admin.workspaces.update) write to a FROZEN workspace', async () => {
    // Otherwise admins could never unfreeze. The slug also doubles as the
    // permission the admin uses to change Status itself.
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(
      new Set(['task.create', 'admin.workspaces.update']),
    );
    mocks.statuses.set('ws-frozen', { Id: 'ws-frozen', Status: 'FROZEN', DeletedAt: null });
    const c    = makeContext({ pathParams: { id: 'ws-frozen' }, method: 'POST' });
    const next = vi.fn();

    await requirePermission('task.create', { workspaceParam: 'id' })(c, next);

    expect(next).toHaveBeenCalledOnce();
    // Bypass should also skip the SP call — no point asking if we're not gating.
    expect(mocks.getStatusSpy).not.toHaveBeenCalled();
  });

  it('skips the guard for system-scoped routes (no workspaceId)', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['admin.stats.read']));
    const c    = makeContext({ method: 'POST' });
    const next = vi.fn();

    await requirePermission('admin.stats.read')(c, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.getStatusSpy).not.toHaveBeenCalled();
  });

  it('lets the request through when the workspace lookup returns null — route owns the 404', async () => {
    // We deliberately don't 404 from the freeze guard: the resource the
    // route is about to load probably won't exist either and will produce
    // a better-shaped error.
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.create']));
    const c    = makeContext({ pathParams: { id: 'ws-missing' }, method: 'POST' });
    const next = vi.fn();

    await requirePermission('task.create', { workspaceParam: 'id' })(c, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('skips the guard when the workspace is archived — DeletedAt is handled elsewhere', async () => {
    // A frozen-AND-archived workspace will be rejected by the route's own
    // resource lookup (which filters DeletedAt). Returning WORKSPACE_FROZEN
    // here would mislead the caller into thinking thaw is the fix.
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.create']));
    mocks.statuses.set('ws-archived', {
      Id: 'ws-archived', Status: 'FROZEN', DeletedAt: new Date('2026-01-01'),
    });
    const c    = makeContext({ pathParams: { id: 'ws-archived' }, method: 'POST' });
    const next = vi.fn();

    await requirePermission('task.create', { workspaceParam: 'id' })(c, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('caches the status lookup across two gates on the same context', async () => {
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set(['task.update', 'task.delete']));
    mocks.statuses.set('ws-1', { Id: 'ws-1', Status: 'ACTIVE', DeletedAt: null });
    const c = makeContext({ pathParams: { id: 'ws-1' }, method: 'POST' });

    const next1 = vi.fn();
    await requirePermission('task.update', { workspaceParam: 'id' })(c, next1);
    const next2 = vi.fn();
    await requirePermission('task.delete', { workspaceParam: 'id' })(c, next2);

    expect(next1).toHaveBeenCalledOnce();
    expect(next2).toHaveBeenCalledOnce();
    expect(mocks.getStatusSpy).toHaveBeenCalledOnce();
  });

  it('still 403s on the permission check before checking freeze status — order matters', async () => {
    // No slug → 403 FORBIDDEN. We must not pay for the status SP when the
    // permission itself has failed (timing leak + wasted DB call).
    vi.mocked(roleService.getUserPermissionSlugs).mockResolvedValue(new Set([]));
    mocks.statuses.set('ws-frozen', { Id: 'ws-frozen', Status: 'FROZEN', DeletedAt: null });
    const c    = makeContext({ pathParams: { id: 'ws-frozen' }, method: 'POST' });
    const next = vi.fn();

    await requirePermission('task.create', { workspaceParam: 'id' })(c, next);

    expect(c._responses()[0]?.status).toBe(403);
    expect(c._responses()[0]?.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(mocks.getStatusSpy).not.toHaveBeenCalled();
  });
});
