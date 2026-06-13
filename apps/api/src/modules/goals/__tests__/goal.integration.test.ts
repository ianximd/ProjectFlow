/**
 * Phase 8e — Goals & Targets integration coverage.
 *
 * Exercises the goals service + SPs + REST + the after-commit recompute hook
 * against the REAL SQL Server stack:
 *   - CRUD: create folder/goal/target; getGoalWithProgress returns targets + an
 *     equal-weighted progress; number/boolean/currency targets compute correctly.
 *   - dueDate is returned as an ISO YYYY-MM-DD string (not a TZ-shifted locale string).
 *   - ACCEPTANCE: a task-linked target's progress advances automatically as its
 *     tasks complete (via taskService.transitionTask → goalService.recomputeForTask).
 *   - NEGATIVE AUTHZ: a non-member (with their OWN workspace) cannot read/delete/
 *     write another tenant's goals/folders/targets (the 3 Batch-4 cross-tenant fixes).
 *
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { goalService } from '../goal.service.js';
import { TaskService } from '../../tasks/task.service.js';
import { TaskRepository } from '../../tasks/task.repository.js';

const taskService = new TaskService(new TaskRepository());

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;
async function seedGraph() {
  seq += 1;
  const owner = await createTestUser({ email: `goal-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Goal Space', key: `GL${(Date.now() + seq) % 100000}` });
  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  return { owner, token, ws, space, listId: String(list.id ?? list.Id) };
}
type Ctx = Awaited<ReturnType<typeof seedGraph>>;

async function makeTask(ctx: Ctx, title: string): Promise<string> {
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: ctx.token, json: { workspaceId: ctx.ws.Id, listId: ctx.listId, title },
  }), 201)).data;
  return String(task.Id ?? task.id);
}
const actorIdOf = (ctx: Ctx) => ctx.owner.user.Id;

describe('Phase 8e — goals & targets (integration)', () => {
  it('CRUD: create goal + number/boolean targets → progress is the equal-weighted average', async () => {
    const ctx = await seedGraph();
    const goal = await goalService.createGoal({ workspaceId: ctx.ws.Id, name: 'Q3 OKR', ownerId: actorIdOf(ctx) });

    await goalService.createTarget(goal.id, { kind: 'number', name: 'Signups', startValue: 0, targetValue: 100, currentValue: 50 }); // 0.5
    await goalService.createTarget(goal.id, { kind: 'boolean', name: 'Launch', currentValue: 1 });                                   // 1

    const withProgress = await goalService.getGoalWithProgress(goal.id);
    expect(withProgress).not.toBeNull();
    expect(withProgress!.targets).toHaveLength(2);
    expect(withProgress!.progress).toBeCloseTo((0.5 + 1) / 2);
  });

  it('REST: full goal lifecycle via the API + dueDate round-trips as ISO YYYY-MM-DD', async () => {
    const ctx = await seedGraph();
    const created = (await json<{ data: any }>(await request('/goals', {
      method: 'POST', token: ctx.token, json: { workspaceId: ctx.ws.Id, name: 'Ship v2', dueDate: '2026-09-30' },
    }), 201)).data;
    expect(created.status).toBe('active');
    expect(created.dueDate).toBe('2026-09-30'); // ISO date, not a locale/TZ-shifted string

    const patched = (await json<{ data: any }>(await request(`/goals/${created.id}`, {
      method: 'PATCH', token: ctx.token, json: { status: 'achieved' },
    }), 200)).data;
    expect(patched.status).toBe('achieved');
    expect(patched.dueDate).toBe('2026-09-30'); // unchanged by a status-only PATCH

    const list = (await json<{ data: any[] }>(await request(`/goals?workspaceId=${ctx.ws.Id}`, { token: ctx.token }), 200)).data;
    expect(list.map((g) => g.id)).toContain(created.id);
  });

  it('ACCEPTANCE: a task-linked target advances automatically as its tasks complete', async () => {
    const ctx = await seedGraph();
    const t1 = await makeTask(ctx, 'Task A');
    const t2 = await makeTask(ctx, 'Task B');

    const goal = await goalService.createGoal({ workspaceId: ctx.ws.Id, name: 'Done all', ownerId: actorIdOf(ctx) });
    const target = await goalService.createTarget(goal.id, {
      kind: 'task', name: 'Close tasks', taskFilter: JSON.stringify({ taskIds: [t1, t2] }),
    });

    // Seed the totals (TaskFilter set; nothing done yet → 0/2 = 0).
    await goalService['repo'].recomputeTaskValue(target.id);
    const wp = await goalService.getGoalWithProgress(goal.id);
    expect(wp!.progress).toBe(0);

    // Complete the first task → recomputeForTask fires after-commit (fire-and-forget).
    await taskService.transitionTask(t1, 'Done', actorIdOf(ctx));
    await waitForProgress(goal.id, 0.5);

    // Complete the second → progress reaches 100%.
    await taskService.transitionTask(t2, 'Done', actorIdOf(ctx));
    await waitForProgress(goal.id, 1);
  });
});

describe('Phase 8e — goals cross-tenant authz (negative)', () => {
  it('a non-member with their OWN workspace cannot read/delete/write another tenant goals/folders/targets', async () => {
    // Victim tenant: owner creates a folder, a goal, and a target.
    const victim = await seedGraph();
    const goal = await goalService.createGoal({ workspaceId: victim.ws.Id, name: 'Secret OKR', ownerId: actorIdOf(victim) });
    const target = await goalService.createTarget(goal.id, {
      kind: 'number', name: 'ARR', currencyCode: 'USD', startValue: 0, targetValue: 1000, currentValue: 250,
    });
    const folder = (await json<{ data: any }>(await request('/goals/folders', {
      method: 'POST', token: victim.token, json: { workspaceId: victim.ws.Id, name: 'Confidential' },
    }), 201)).data;

    // Attacker: a real user who OWNS their own workspace (so they DO hold goal.* —
    // but only in THEIR workspace). This proves the gates resolve the RESOURCE's
    // workspace, not a caller-supplied param / URL goalId.
    const attacker = await createTestUser({ email: `goal-atk-${Date.now()}@projectflow.test` });
    const aToken = attacker.accessToken;
    const aWs = await createTestWorkspace(aToken);
    const aGoal = await goalService.createGoal({ workspaceId: aWs.Id, name: 'Attacker goal', ownerId: attacker.user.Id });

    // C1 — cross-tenant READ is denied on every GET surface.
    expect((await request(`/goals/${goal.id}`, { token: aToken })).status).toBe(403);
    expect((await request(`/goals?workspaceId=${victim.ws.Id}`, { token: aToken })).status).toBe(403);
    expect((await request(`/goals/folders?workspaceId=${victim.ws.Id}`, { token: aToken })).status).toBe(403);
    expect((await request(`/goals/${goal.id}/targets`, { token: aToken })).status).toBe(403);

    // C2 — folder delete authorizes the FOLDER's workspace, ignoring a spoofed ?workspaceId.
    expect((await request(`/goals/folders/${folder.id}?workspaceId=${aWs.Id}`, { method: 'DELETE', token: aToken })).status).toBe(403);

    // I3 — target write authorizes the TARGET's workspace, not the URL goalId (attacker's).
    expect((await request(`/goals/${aGoal.id}/targets/${target.id}`, { method: 'PATCH', token: aToken, json: { currentValue: 999 } })).status).toBe(403);
    expect((await request(`/goals/${aGoal.id}/targets/${target.id}`, { method: 'DELETE', token: aToken })).status).toBe(403);

    // The victim's data is completely untouched.
    const after = await goalService.getGoalWithProgress(goal.id);
    expect(after).not.toBeNull();
    expect(after!.targets).toHaveLength(1);
    expect(after!.targets[0].currentValue).toBe(250);
    const folders = (await json<{ data: any[] }>(await request(`/goals/folders?workspaceId=${victim.ws.Id}`, { token: victim.token }), 200)).data;
    expect(folders.map((f) => f.id)).toContain(folder.id);
  });
});

/** Poll getGoalWithProgress until progress reaches `target` (the hook is fire-and-forget). */
async function waitForProgress(goalId: string, target: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const wp = await goalService.getGoalWithProgress(goalId);
    if (wp && Math.abs(wp.progress - target) < 1e-6) return;
    if (Date.now() > deadline) throw new Error(`goal ${goalId} progress did not reach ${target} (last ${wp?.progress}) after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
