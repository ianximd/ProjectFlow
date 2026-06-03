import { describe, expect, it, vi } from 'vitest';
const { AccessService } = await import('../access.service.js');

function makeRepo(resolved: { Level: any; Found: boolean }) {
  return { resolve: vi.fn().mockResolvedValue(resolved) } as any;
}

describe('AccessService.can', () => {
  it('grants when resolved level meets the minimum', async () => {
    const svc = new AccessService(makeRepo({ Level: 'EDIT', Found: true }));
    expect(await svc.can('u1', 'LIST', 'l1', 'VIEW')).toBe(true);
    expect(await svc.can('u1', 'LIST', 'l1', 'EDIT')).toBe(true);
  });
  it('denies when resolved level is below the minimum', async () => {
    const svc = new AccessService(makeRepo({ Level: 'VIEW', Found: true }));
    expect(await svc.can('u1', 'LIST', 'l1', 'EDIT')).toBe(false);
  });
  it('denies (403) when found but level is null (private-space gate)', async () => {
    const svc = new AccessService(makeRepo({ Level: null, Found: true }));
    expect(await svc.can('u1', 'SPACE', 's1', 'VIEW')).toBe(false);
  });
  it('reports notFound when the object does not exist', async () => {
    const svc = new AccessService(makeRepo({ Level: null, Found: false }));
    expect(await svc.resolveOrNull('u1', 'SPACE', 'missing')).toEqual({ level: null, found: false });
  });
});
