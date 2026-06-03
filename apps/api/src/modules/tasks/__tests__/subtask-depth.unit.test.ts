import { describe, expect, it, vi } from 'vitest';
import { TaskService } from '../task.service.js';

describe('TaskService.createTask subtask-depth mapping', () => {
  it('propagates SP error 51230 (route maps to 422)', async () => {
    const repo = { create: vi.fn().mockRejectedValue(Object.assign(new Error('Subtask depth exceeds the space limit'), { number: 51230 })) } as any;
    const svc = new TaskService(repo);
    await expect(svc.createTask({ title: 'x', listId: 'l1', workspaceId: 'w1' } as any, 'u1'))
      .rejects.toMatchObject({ number: 51230 });
  });
});
