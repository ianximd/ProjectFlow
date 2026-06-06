/**
 * Phase 5a — task Dependencies integration coverage (Batch 5).
 *
 * Exercises the dependency service against the REAL SQL Server stack so the
 * stored-procedure edge guards (self-edge 51500, cycle 51501), the directed
 * (waitingOn / blocking) edge mapping, the open-blocker close gate, and the
 * cascade-reschedule of dependents are all verified end-to-end.
 *
 * The service is driven directly (it owns no HTTP-layer concerns), while the
 * surrounding graph (workspace / user / project / list / tasks) is seeded over
 * the same in-process REST app the other integration suites use. Transitions
 * and date updates go through TaskService so the dependency hooks
 * (assertNoOpenBlockers on close, rescheduleDependents on a date move) run.
 *
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import {
  createTestUser,
  createTestWorkspace,
  createTestProject,
} from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { dependencyService, DependencyWarningError } from '../dependency.service.js';
import { TaskRepository } from '../../tasks/task.repository.js';
import { TaskService } from '../../tasks/task.service.js';

const taskService = new TaskService(new TaskRepository());

beforeEach(async () => { await truncateAll(); });
afterAll  (async () => { await closePool();   });

let seq = 0;

/** Seed a workspace + project (Space) + default List owned by a fresh user. */
async function seedGraph() {
  seq += 1;
  const owner = await createTestUser({ email: `dep-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws    = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Dep Space', key: `DP${(Date.now() + seq) % 100000}` });
  const list  = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token,
    json:   { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;
  return { owner, token, ws, space, listId: list.id ?? list.Id };
}

/** Create a task in the seeded list and return its id (uppercased for compares). */
async function makeTask(ctx: Awaited<ReturnType<typeof seedGraph>>, title: string): Promise<string> {
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: ctx.token,
    json:   { workspaceId: ctx.ws.Id, listId: ctx.listId, title },
  }), 201)).data;
  return String(task.Id ?? task.id);
}

/** Case-insensitive membership: dependency refs round-trip GUIDs whose casing
 *  isn't guaranteed to match the create response. */
function idsUpper(refs: { taskId: string }[]): string[] {
  return refs.map((r) => r.taskId.toUpperCase());
}

describe('Phase 5a — dependency service (integration)', () => {
  it('adds a waiting_on edge — A.waitingOn has B and B.blocking has A; remove clears both', async () => {
    const ctx = await seedGraph();
    const a = await makeTask(ctx, 'Task A');
    const b = await makeTask(ctx, 'Task B');

    // (a) A waits on B.
    await dependencyService.add(a, b, 'waiting_on', ctx.ws.Id);

    const aLists = await dependencyService.list(a);
    const bLists = await dependencyService.list(b);
    expect(idsUpper(aLists.waitingOn)).toContain(b.toUpperCase());
    expect(idsUpper(aLists.blocking)).not.toContain(b.toUpperCase());
    expect(idsUpper(bLists.blocking)).toContain(a.toUpperCase());
    expect(idsUpper(bLists.waitingOn)).not.toContain(a.toUpperCase());

    // (b) remove the edge → both lists empty for this pair.
    const removed = await dependencyService.remove(a, b, 'waiting_on');
    expect(removed).toBe(1);

    const aAfter = await dependencyService.list(a);
    const bAfter = await dependencyService.list(b);
    expect(aAfter.waitingOn).toHaveLength(0);
    expect(aAfter.blocking).toHaveLength(0);
    expect(bAfter.waitingOn).toHaveLength(0);
    expect(bAfter.blocking).toHaveLength(0);
  });

  it('rejects a direct cycle (A→B then B→A) with SP error 51501', async () => {
    const ctx = await seedGraph();
    const a = await makeTask(ctx, 'Cyc A');
    const b = await makeTask(ctx, 'Cyc B');

    await dependencyService.add(a, b, 'waiting_on', ctx.ws.Id);
    await expect(dependencyService.add(b, a, 'waiting_on', ctx.ws.Id))
      .rejects.toMatchObject({ number: 51501 });
  });

  it('rejects a transitive cycle (A→B, B→C, then C→A) with SP error 51501', async () => {
    const ctx = await seedGraph();
    const a = await makeTask(ctx, 'Tri A');
    const b = await makeTask(ctx, 'Tri B');
    const c = await makeTask(ctx, 'Tri C');

    await dependencyService.add(a, b, 'waiting_on', ctx.ws.Id);
    await dependencyService.add(b, c, 'waiting_on', ctx.ws.Id);
    await expect(dependencyService.add(c, a, 'waiting_on', ctx.ws.Id))
      .rejects.toMatchObject({ number: 51501 });
  });

  it('rejects a self-edge (A waits on A) with SP error 51500', async () => {
    const ctx = await seedGraph();
    const a = await makeTask(ctx, 'Self A');

    await expect(dependencyService.add(a, a, 'waiting_on', ctx.ws.Id))
      .rejects.toMatchObject({ number: 51500 });
  });

  it('open-blocker gate: assertNoOpenBlockers throws while B is open, resolves once B is done', async () => {
    const ctx = await seedGraph();
    const a = await makeTask(ctx, 'Gate A');
    const b = await makeTask(ctx, 'Gate B');

    await dependencyService.add(a, b, 'waiting_on', ctx.ws.Id);

    // B is fresh ("To Do") → A has an open blocker.
    await expect(dependencyService.assertNoOpenBlockers(a)).rejects.toBeInstanceOf(DependencyWarningError);
    try {
      await dependencyService.assertNoOpenBlockers(a);
    } catch (err) {
      expect(err).toBeInstanceOf(DependencyWarningError);
      expect((err as DependencyWarningError).blockers.map((x) => x.taskId.toUpperCase()))
        .toContain(b.toUpperCase());
    }

    // Close B (DONE-group status) → the blocker is no longer open.
    await taskService.transitionTask(b, 'Done', ctx.owner.user.Id);
    await expect(dependencyService.assertNoOpenBlockers(a)).resolves.toBeUndefined();
  });

  it('rejects a cross-workspace dependency with 404 (IDOR guard at the route)', async () => {
    // Two independent graphs → two distinct workspaces, each with its own task.
    const ctxA = await seedGraph();
    const ctxB = await seedGraph();
    const a   = await makeTask(ctxA, 'WS-A Task');
    const bForeign = await makeTask(ctxB, 'WS-B Task');

    // A's owner has task.update on workspace A (passes the permission gate), but
    // bForeign lives in workspace B → the route's same-workspace guard must 404
    // BEFORE the service/SP runs (no existence leak across workspaces).
    const res = await request(`/tasks/${encodeURIComponent(a)}/dependencies`, {
      method: 'POST',
      token:  ctxA.token,
      json:   { dependsOnId: bForeign },
    });
    expect(res.status).toBe(404);
    const body = await json<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('NOT_FOUND');

    // And nothing was written for A.
    const aLists = await dependencyService.list(a);
    expect(aLists.waitingOn).toHaveLength(0);
    expect(aLists.blocking).toHaveLength(0);
  });

  it('reschedule: moving B due date by N days shifts dependent A start/due by N', async () => {
    const ctx = await seedGraph();
    const a = await makeTask(ctx, 'Sched A');
    const b = await makeTask(ctx, 'Sched B');

    // A waits on B.
    await dependencyService.add(a, b, 'waiting_on', ctx.ws.Id);

    const pool = await getPool();
    // Seed deterministic dates directly: usp_Task_Update only sets DueDate (and
    // can't set StartDate), so set both columns at the SQL boundary. DATE-ish
    // values at UTC midnight keep the whole-day delta exact.
    //   B due  = 2026-01-10
    //   A start= 2026-01-15, A due = 2026-01-20
    await pool.request()
      .input('B', b)
      .query("UPDATE dbo.Tasks SET DueDate = '2026-01-10T00:00:00' WHERE Id = @B");
    await pool.request()
      .input('A', a)
      .query("UPDATE dbo.Tasks SET StartDate = '2026-01-15T00:00:00', DueDate = '2026-01-20T00:00:00' WHERE Id = @A");

    // Move B's due date forward by 5 days → 2026-01-15. updateTask computes the
    // whole-day delta (+5) from before/after and cascades to dependents.
    const N = 5;
    await taskService.updateTask(b, { dueDate: '2026-01-15T00:00:00.000Z' }, ctx.owner.user.Id);

    // Assert the STORED dates on A shifted by exactly N days.
    const after = await pool.request()
      .input('A', a)
      .query('SELECT StartDate, DueDate FROM dbo.Tasks WHERE Id = @A');
    const row = after.recordset[0];
    expect(row).toBeTruthy();

    const startUtc = new Date(row.StartDate);
    const dueUtc   = new Date(row.DueDate);
    // Original A: start 01-15, due 01-20 → +5 days = 01-20 and 01-25.
    expect(startUtc.getUTCFullYear()).toBe(2026);
    expect(startUtc.getUTCMonth()).toBe(0); // January
    expect(startUtc.getUTCDate()).toBe(15 + N);
    expect(dueUtc.getUTCDate()).toBe(20 + N);
  });
});
