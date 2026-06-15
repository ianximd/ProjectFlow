import { describe, it, expect, vi } from 'vitest';
import type { Context, Next } from 'hono';

vi.mock('../../../modules/apps/app.service.js', () => ({
  appService: {
    chainForScope: vi.fn(async () => []),
    resolveAllFromChain: vi.fn(),
    isEnabled: vi.fn(),
  },
}));
import { appService } from '../../../modules/apps/app.service.js';
import { requireApp } from '../requireApp.middleware.js';

function fakeCtx(): { c: any; jsonArg: any } {
  const store = new Map<string, unknown>();
  const out: any = { jsonArg: undefined };
  const c: any = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, v),
    req: { param: () => 't1' },
    json: (body: any, status?: number) => { out.jsonArg = { body, status }; return out.jsonArg; },
  };
  c.set('user', { userId: 'u1' });
  return { c, jsonArg: out };
}

const scope = { workspaceId: 'w1', scopeType: 'list' as const, scopeId: 'l1' };

describe('requireApp', () => {
  it('calls next() when the app resolves enabled', async () => {
    (appService.chainForScope as any).mockResolvedValue([]); // time_tracking defaults ON
    const { c } = fakeCtx();
    const next = vi.fn(async () => {});
    await requireApp('time_tracking', async () => scope)(c as Context, next as Next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns a 404 feature-absent when the app resolves disabled', async () => {
    (appService.chainForScope as any).mockResolvedValue([
      { appKey: 'time_tracking', enabled: false, scopeType: 'list', scopeId: 'l1', depth: 9999 },
    ]);
    const { c } = fakeCtx();
    const next = vi.fn(async () => {});
    const res: any = await requireApp('time_tracking', async () => scope)(c as Context, next as Next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body.error.code).toBe('APP_DISABLED');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the scope cannot be resolved (fail-closed)', async () => {
    const { c } = fakeCtx();
    const next = vi.fn(async () => {});
    const res: any = await requireApp('time_tracking', async () => null)(c as Context, next as Next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });
});
