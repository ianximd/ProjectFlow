import { describe, expect, it, vi } from 'vitest';
const { ListService } = await import('../list.service.js');

function makeRepo(statuses: any[]) {
  return { effectiveStatuses: vi.fn().mockResolvedValue(statuses) } as any;
}

describe('ListService.effectiveStatuses', () => {
  it('maps SP rows (PascalCase) to camelCase status objects, preserving SP order', async () => {
    const svc = new ListService(makeRepo([
      { Id: 's1', Name: 'To Do', Category: 'TODO',        Color: '#999', Position: 0 },
      { Id: 's2', Name: 'Doing', Category: 'IN_PROGRESS', Color: '#00f', Position: 1 },
    ]));
    const out = await svc.effectiveStatuses('l1');
    expect(out.map((s) => s.name)).toEqual(['To Do', 'Doing']);
    expect(out[1]).toMatchObject({ id: 's2', category: 'IN_PROGRESS', color: '#00f', position: 1 });
  });
});
