/**
 * Phase 5c — Recurring tasks integration coverage (Batch 3).
 *
 * Exercises the recurrence service + SPs + the on-complete transition wiring +
 * the scheduled sweep against the REAL SQL Server stack:
 *   - on-complete spawn: a DONE-group transition (via taskService.transitionTask)
 *     clones the source task into the same list with remapped dates, copied
 *     assignee + custom-field value, and a reset (non-done) status; the
 *     recurrence's LastSpawnedTaskId + NextRunAt advance.
 *   - scheduled sweep: a `schedule`-mode rule whose NextRunAt is in the past is
 *     picked up by runRecurrenceSweep() and spawns the next occurrence.
 *   - termination: a `count: 1` rule deactivates after the single spawn; a
 *     subsequent complete/sweep does NOT spawn again.
 *   - clear: clearing the rule makes getForTask return null and stops spawns.
 *
 * A DEFAULT workflow is attached to each seeded project so the list resolves
 * ordered statuses (first = 'Ideas', a non-DONE category) — that is the status
 * the spawned occurrence is reset to. Without a workflow, effectiveStatuses
 * returns empty and the clone would inherit the source's (DONE) status.
 *
 * DB SAFETY: must target the local Docker ProjectFlow_Test DB (see e2e/README).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool, getPool } from '../../../shared/lib/db.js';
import { recurrenceService } from '../recurrence.service.js';
import { recurrenceRepository } from '../recurrence.repository.js';
import { runRecurrenceSweep } from '../recurrence.worker.js';
import { TaskService } from '../../tasks/task.service.js';
import { TaskRepository } from '../../tasks/task.repository.js';
import { customFieldService } from '../../customfields/customfield.service.js';

// The routes instantiate TaskService inline; there is no exported singleton, so
// build one over a real repository (same construction the route uses).
const taskService = new TaskService(new TaskRepository());

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;

/**
 * Seed a fresh user + workspace + project (with a DEFAULT workflow) + one list.
 * The workflow makes the project's lists resolve ordered statuses so the spawned
 * occurrence resets to a non-DONE status.
 */
async function seedGraph() {
  seq += 1;
  const owner = await createTestUser({ email: `rec-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, { name: 'Rec Space', key: `RC${(Date.now() + seq) % 100000}` });

  // Attach a DEFAULT workflow to the project (statuses: Ideas/To Do/In Progress/
  // Testing/Done, with To Do→In Progress→Done transitions). usp_Workflow_Create
  // also sets Projects.WorkflowId, so the list inherits it via effectiveStatuses.
  const pool = await getPool();
  await pool.request()
    .input('ProjectId', sql.UniqueIdentifier, space.Id)
    .input('Name', sql.NVarChar(100), 'Default WF')
    .input('Template', sql.NVarChar(20), 'DEFAULT')
    .execute('usp_Workflow_Create');

  const list = (await json<{ data: any }>(await request('/lists', {
    method: 'POST', token, json: { workspaceId: ws.Id, spaceId: space.Id, folderId: null, name: 'Default', position: 0 },
  }), 201)).data;

  return { owner, token, ws, space, listId: String(list.id ?? list.Id) };
}

type Ctx = Awaited<ReturnType<typeof seedGraph>>;

/** Create a task INTO the list (so it bridges ProjectId from the list's Space). */
async function makeTask(ctx: Ctx, title: string): Promise<string> {
  const task = (await json<{ data: any }>(await request('/tasks', {
    method: 'POST', token: ctx.token, json: { workspaceId: ctx.ws.Id, listId: ctx.listId, title },
  }), 201)).data;
  return String(task.Id ?? task.id);
}

/** Set Start + Due dates directly (usp_Task_UpdateDates). StartDate is DATE. */
async function setDates(taskId: string, start: Date, due: Date): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('TaskId', sql.UniqueIdentifier, taskId)
    .input('RequesterId', sql.UniqueIdentifier, null)
    .input('StartDate', sql.Date, start)
    .input('DueDate', sql.DateTime2, due)
    .execute('usp_Task_UpdateDates');
}

/** Force a recurrence row's NextRunAt (e.g. into the past for the sweep). */
async function forceNextRunAt(recurrenceId: string, when: Date | null): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('Id', sql.UniqueIdentifier, recurrenceId)
    .input('When', sql.DateTime2, when)
    .query('UPDATE dbo.TaskRecurrences SET NextRunAt = @When WHERE Id = @Id');
}

/** All non-deleted tasks in the list (newest first), via a direct read. */
async function listTasks(listId: string): Promise<Array<{ Id: string; Title: string; Status: string; StartDate: Date | null; DueDate: Date | null }>> {
  const pool = await getPool();
  const r = await pool.request()
    .input('ListId', sql.UniqueIdentifier, listId)
    .query('SELECT Id, Title, Status, StartDate, DueDate FROM dbo.Tasks WHERE ListId = @ListId AND DeletedAt IS NULL ORDER BY CreatedAt DESC');
  return r.recordset as any[];
}

/** Poll for a spawned (newest non-source) task — the on-complete spawn is
 *  fire-and-forget inside transitionTask, so wait for it to settle. */
async function waitForSpawn(listId: string, sourceId: string, timeoutMs = 10_000): Promise<{ Id: string; Title: string; Status: string; StartDate: Date | null; DueDate: Date | null }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tasks = await listTasks(listId);
    const spawned = tasks.find((t) => String(t.Id).toUpperCase() !== sourceId.toUpperCase());
    if (spawned) return spawned;
    if (Date.now() > deadline) throw new Error(`no spawned task in list ${listId} after ${timeoutMs}ms (have ${tasks.length})`);
    await new Promise((res) => setTimeout(res, 100));
  }
}

const actorIdOf = (ctx: Ctx) => ctx.owner.user.Id;

describe('Phase 5c — recurring tasks (integration)', () => {
  it('on-complete: a DONE transition clones the task with remapped dates, copied assignee + custom field, reset status', async () => {
    const ctx = await seedGraph();
    const numField = (await json<{ data: any }>(await request('/custom-fields', {
      method: 'POST', token: ctx.token, json: { scopeType: 'SPACE', scopeId: ctx.space.Id, type: 'number', name: 'Effort' },
    }), 201)).data;

    const source = await makeTask(ctx, 'Daily standup');
    const start = new Date('2026-01-10T00:00:00.000Z');
    const due = new Date('2026-01-12T09:00:00.000Z'); // 2-day start→due duration
    await setDates(source, start, due);

    // Assignee (the owner is a workspace member) + a custom-field value.
    await taskService.setAssignees(source, [actorIdOf(ctx)], actorIdOf(ctx));
    await customFieldService.setValue(source, numField.id, 5);

    // Daily, on_complete.
    const rec = await recurrenceService.setForTask(source, { rule: { freq: 'daily', interval: 1 }, regenerateMode: 'on_complete' });
    expect(rec.active).toBe(true);

    // Drive the source to a DONE status via the workflow path: To Do → In Progress → Done.
    await taskService.transitionTask(source, 'In Progress', actorIdOf(ctx));
    await taskService.transitionTask(source, 'Done', actorIdOf(ctx));

    // The on-complete spawn is fire-and-forget — poll for the new occurrence.
    const spawned = await waitForSpawn(ctx.listId, source);

    // Same title, reset (non-DONE) status — the list's first effective status.
    expect(spawned.Title).toBe('Daily standup');
    expect(spawned.Status).toBe('Ideas');           // first DEFAULT status (Position 0)
    expect(['Done', 'Resolved', 'Closed', 'Completed']).not.toContain(spawned.Status);

    // Dates remapped to the next occurrence (due + 1 day), start→due duration kept (2 days).
    expect(spawned.DueDate).not.toBeNull();
    const newDue = new Date(spawned.DueDate as any);
    expect(newDue.getTime()).toBe(new Date('2026-01-13T09:00:00.000Z').getTime());
    expect(spawned.StartDate).not.toBeNull();
    const newStart = new Date(spawned.StartDate as any);
    // StartDate is DATE-typed → midnight UTC; duration preserved = 2 days before due's day.
    expect(newStart.getUTCFullYear()).toBe(2026);
    expect(newStart.getUTCMonth()).toBe(0);
    expect(newStart.getUTCDate()).toBe(11);

    // Assignee copied.
    const assignees = await pool_getAssignees(spawned.Id);
    expect(assignees.map((a) => a.toUpperCase())).toContain(actorIdOf(ctx).toUpperCase());

    // Custom-field value copied.
    const eff = await customFieldService.effectiveForTask(spawned.Id);
    expect(eff.find((e) => e.field.id === numField.id)?.value).toBe(5);

    // Recurrence advanced: LastSpawnedTaskId set, NextRunAt advanced, still active.
    const after = await recurrenceService.getForTask(source);
    expect(after).not.toBeNull();
    expect(after!.active).toBe(true);
    expect(after!.lastSpawnedTaskId?.toUpperCase()).toBe(spawned.Id.toUpperCase());
    expect(after!.nextRunAt).not.toBeNull();
  });

  it('scheduled sweep: a schedule-mode rule with a past NextRunAt spawns the next occurrence', async () => {
    const ctx = await seedGraph();
    const source = await makeTask(ctx, 'Weekly report');
    const due = new Date('2026-02-02T08:00:00.000Z');
    await setDates(source, due, due);

    const rec = await recurrenceService.setForTask(source, { rule: { freq: 'weekly', interval: 1 }, regenerateMode: 'schedule' });
    // Force NextRunAt into the past so ListDue picks it up.
    await forceNextRunAt(rec.id, new Date(Date.now() - 60_000));

    const before = await listTasks(ctx.listId);
    expect(before).toHaveLength(1);

    const result = await runRecurrenceSweep(new Date());
    expect(result.spawned).toBeGreaterThanOrEqual(1);

    const spawned = await waitForSpawn(ctx.listId, source, 1_000);
    expect(spawned.Title).toBe('Weekly report');

    const after = await recurrenceService.getForTask(source);
    expect(after!.active).toBe(true);
    expect(after!.lastSpawnedTaskId?.toUpperCase()).toBe(spawned.Id.toUpperCase());
    expect(after!.nextRunAt).not.toBeNull();
  });

  it('termination (count: 1): the recurrence deactivates after one spawn; a second sweep does not spawn again', async () => {
    const ctx = await seedGraph();
    const source = await makeTask(ctx, 'One-shot');
    const due = new Date('2026-03-01T08:00:00.000Z');
    await setDates(source, due, due);

    const rec = await recurrenceService.setForTask(source, { rule: { freq: 'daily', interval: 1, count: 1 }, regenerateMode: 'schedule' });
    await forceNextRunAt(rec.id, new Date(Date.now() - 60_000));

    const first = await runRecurrenceSweep(new Date());
    expect(first.spawned).toBe(1);

    // Deactivated after the single spawn.
    const after = await recurrenceService.getForTask(source);
    expect(after!.active).toBe(false);
    expect(after!.nextRunAt).toBeNull();

    const countAfterFirst = (await listTasks(ctx.listId)).length;
    expect(countAfterFirst).toBe(2); // source + 1 spawn

    // A subsequent sweep finds nothing due (Active=0 excluded by ListDue) → no new task.
    const second = await runRecurrenceSweep(new Date());
    expect(second.spawned).toBe(0);
    expect((await listTasks(ctx.listId)).length).toBe(2);
  });

  it('termination (count: 1, on_complete): completing again does not spawn a second occurrence', async () => {
    const ctx = await seedGraph();
    const source = await makeTask(ctx, 'Complete-once');
    const due = new Date('2026-04-01T08:00:00.000Z');
    await setDates(source, due, due);

    await recurrenceService.setForTask(source, { rule: { freq: 'daily', interval: 1, count: 1 }, regenerateMode: 'on_complete' });

    await taskService.transitionTask(source, 'In Progress', actorIdOf(ctx));
    await taskService.transitionTask(source, 'Done', actorIdOf(ctx));
    const spawned = await waitForSpawn(ctx.listId, source);
    expect(spawned.Title).toBe('Complete-once');

    const after = await recurrenceService.getForTask(source);
    expect(after!.active).toBe(false);

    // Reopen + re-complete the SOURCE — an inactive recurrence must not spawn again.
    await taskService.transitionTask(source, 'In Progress', actorIdOf(ctx)); // Done → In Progress (Reopen)
    await taskService.transitionTask(source, 'Done', actorIdOf(ctx));
    // Give any (incorrect) fire-and-forget spawn a window to run, then assert count unchanged.
    await new Promise((res) => setTimeout(res, 500));
    expect((await listTasks(ctx.listId)).length).toBe(2); // source + the single spawn
  });

  it('FIX 1 (atomic claim): two spawnNext calls for the same pre-read occurrence produce exactly ONE clone + one advance', async () => {
    const ctx = await seedGraph();
    const source = await makeTask(ctx, 'Race me');
    const due = new Date('2026-07-01T08:00:00.000Z');
    await setDates(source, due, due);

    // schedule mode + a forced past NextRunAt so the recurrence is "due" and the
    // two callers (on-complete trigger vs. sweep) both read the SAME row state.
    const rec = await recurrenceService.setForTask(source, { rule: { freq: 'daily', interval: 1 }, regenerateMode: 'both' });
    await forceNextRunAt(rec.id, new Date(Date.now() - 60_000));

    // Re-read so both racing callers start from the identical pre-read object
    // (same observed NextRunAt — exactly the double-spawn race scenario).
    const preRead = (await recurrenceService.getForTask(source))!;
    expect(preRead.nextRunAt).not.toBeNull();

    const before = await listTasks(ctx.listId);
    expect(before).toHaveLength(1);

    // Fire both with the SAME object. The atomic claim must let only one win.
    const [a, b] = await Promise.all([
      recurrenceService.spawnNext(preRead),
      recurrenceService.spawnNext(preRead),
    ]);

    // Exactly one returned a new task id; the other was rejected by the claim.
    const winners = [a, b].filter((x) => x !== null);
    expect(winners).toHaveLength(1);

    // Exactly ONE new task in the list (source + one clone), not two.
    const after = await listTasks(ctx.listId);
    expect(after).toHaveLength(2);

    // The recurrence advanced exactly ONCE. The spawn clones for the 2026-07-02
    // occurrence (one daily step past the 2026-07-01 due) and sets NextRunAt to
    // the FOLLOWING occurrence, 2026-07-03. A double-advance would have skipped to
    // 2026-07-04 — assert it landed on 07-03 (exactly one advance).
    const rr = (await recurrenceService.getForTask(source))!;
    expect(rr.active).toBe(true);
    expect(rr.nextRunAt).not.toBeNull();
    expect(rr.lastSpawnedTaskId?.toUpperCase()).toBe(winners[0]!.toUpperCase());
    const advancedDay = new Date(rr.nextRunAt as any);
    expect(advancedDay.getTime()).toBe(new Date('2026-07-03T08:00:00.000Z').getTime());
  });

  it('FIX 1 (count + atomic claim): a double spawn of a count:2 occurrence decrements the count exactly once', async () => {
    const ctx = await seedGraph();
    const source = await makeTask(ctx, 'Counted race');
    const due = new Date('2026-08-01T08:00:00.000Z');
    await setDates(source, due, due);

    const rec = await recurrenceService.setForTask(source, { rule: { freq: 'daily', interval: 1, count: 2 }, regenerateMode: 'both' });
    await forceNextRunAt(rec.id, new Date(Date.now() - 60_000));
    const preRead = (await recurrenceService.getForTask(source))!;

    const [a, b] = await Promise.all([
      recurrenceService.spawnNext(preRead),
      recurrenceService.spawnNext(preRead),
    ]);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);

    // Count must have decremented from 2 → 1 (NOT 2 → 0): still active, one spawn.
    const rr = (await recurrenceService.getForTask(source))!;
    expect(rr.active).toBe(true);
    expect((rr.rule as any).count).toBe(1);
    expect((await listTasks(ctx.listId)).length).toBe(2); // source + 1 clone
  });

  it('FIX 2 (idempotency): Done→Done and Done→Resolved do NOT re-spawn; only the first into-done crossing spawns', async () => {
    const ctx = await seedGraph();

    // Extend the seeded DEFAULT workflow with a second DONE-category status
    // ("Resolved") + a Done→Resolved transition so we can drive a done→done
    // (cross-status, both DONE-category) transition through the workflow gate.
    const pool = await getPool();
    const wf = await pool.request()
      .input('ProjectId', sql.UniqueIdentifier, ctx.space.Id)
      .execute('usp_Workflow_GetByProject');
    const workflowId = (wf.recordset[0] as any).Id ?? (wf.recordset[0] as any).id;
    await pool.request()
      .input('WorkflowId', sql.UniqueIdentifier, workflowId)
      .input('Name', sql.NVarChar(100), 'Resolved')
      .input('Category', sql.NVarChar(20), 'DONE')
      .input('Color', sql.NVarChar(20), '#16a34a')
      .execute('usp_Workflow_AddStatus');
    await pool.request()
      .input('WorkflowId', sql.UniqueIdentifier, workflowId)
      .input('FromStatus', sql.NVarChar(100), 'Done')
      .input('ToStatus', sql.NVarChar(100), 'Resolved')
      .input('Name', sql.NVarChar(100), 'Mark Resolved')
      .execute('usp_Workflow_AddTransition');

    const source = await makeTask(ctx, 'Once only');
    const due = new Date('2026-09-01T08:00:00.000Z');
    await setDates(source, due, due);

    // Infinite (no count) on_complete recurrence — only the crossing gate stops re-spawns.
    await recurrenceService.setForTask(source, { rule: { freq: 'daily', interval: 1 }, regenerateMode: 'on_complete' });

    // First crossing INTO done: To Do → In Progress → Done → spawns ONE occurrence.
    await taskService.transitionTask(source, 'In Progress', actorIdOf(ctx));
    await taskService.transitionTask(source, 'Done', actorIdOf(ctx));
    const spawned = await waitForSpawn(ctx.listId, source);
    expect(spawned.Title).toBe('Once only');
    expect((await listTasks(ctx.listId)).length).toBe(2); // source + 1 clone

    // Done → Done (no-op, same done-group status) must NOT spawn again.
    await taskService.transitionTask(source, 'Done', actorIdOf(ctx));
    await new Promise((res) => setTimeout(res, 500));
    expect((await listTasks(ctx.listId)).length).toBe(2);

    // Done → Resolved (cross-status, but BOTH done-group) must NOT spawn again.
    await taskService.transitionTask(source, 'Resolved', actorIdOf(ctx));
    await new Promise((res) => setTimeout(res, 500));
    expect((await listTasks(ctx.listId)).length).toBe(2);
  });

  it('FIX 3 (past-due seed clamp): a past source due does not seed a NextRunAt in the past', async () => {
    const ctx = await seedGraph();
    const source = await makeTask(ctx, 'Stale due');
    // Source due well in the past.
    const pastDue = new Date(Date.now() - 30 * 86_400_000);
    await setDates(source, pastDue, pastDue);

    const rec = await recurrenceService.setForTask(source, { rule: { freq: 'weekly', interval: 1 }, regenerateMode: 'schedule' });
    expect(rec.nextRunAt).not.toBeNull();
    // The seeded NextRunAt must be in the FUTURE (re-seeded from now), not the past.
    expect(new Date(rec.nextRunAt as any).getTime()).toBeGreaterThan(Date.now());
  });

  it('clear: getForTask returns null after clear and completing no longer spawns', async () => {
    const ctx = await seedGraph();
    const source = await makeTask(ctx, 'Cleared task');
    const due = new Date('2026-05-01T08:00:00.000Z');
    await setDates(source, due, due);

    await recurrenceService.setForTask(source, { rule: { freq: 'daily', interval: 1 }, regenerateMode: 'on_complete' });
    expect(await recurrenceService.getForTask(source)).not.toBeNull();

    await recurrenceService.clear(source);
    expect(await recurrenceService.getForTask(source)).toBeNull();

    // ListDue must not surface a cleared (soft-deleted) recurrence either.
    expect(await recurrenceRepository.listDue(new Date(Date.now() + 86_400_000))).toHaveLength(0);

    // Completing the source no longer spawns.
    await taskService.transitionTask(source, 'In Progress', actorIdOf(ctx));
    await taskService.transitionTask(source, 'Done', actorIdOf(ctx));
    await new Promise((res) => setTimeout(res, 500));
    expect((await listTasks(ctx.listId)).length).toBe(1); // only the source
  });
});

/** Read a task's assignee user ids directly (the SP path is workspace-scoped). */
async function pool_getAssignees(taskId: string): Promise<string[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('TaskId', sql.UniqueIdentifier, taskId)
    .query('SELECT UserId FROM dbo.TaskAssignees WHERE TaskId = @TaskId');
  return (r.recordset as any[]).map((x) => String(x.UserId));
}
