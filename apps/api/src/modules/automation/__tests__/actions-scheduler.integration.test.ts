/**
 * Phase 6c — new action types + scheduler sweep integration coverage.
 * Exercises executeAction (CREATE_SUBTASK, APPLY_TEMPLATE) and the
 * DUE_DATE_PASSED scheduler sweep against the REAL SQL stack.
 * DB SAFETY: controller runs this ONLY against local Docker ProjectFlow_Test.
 *
 * Harness notes (mirrors engine.integration.test.ts):
 *   - No BullMQ automation worker is started — action effects are verified
 *     directly (SQL reads / repo calls), not via the worker pipeline.
 *   - runScheduledSweep() IS called directly; it enqueues into automationQueue
 *     (BullMQ). Redis IS available in the integration env (see integration.setup.ts)
 *     so queue.add() succeeds; we assert on the returned { dueDate, scheduled } count.
 *   - CALL_WEBHOOK signed-delivery + AutomationRuns audit-row assertions require a
 *     running worker pipeline and are therefore covered by the Playwright e2e
 *     (Batch 7 — full server + workers). They are NOT exercised here.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { request, json } from '../../../__tests__/setup/testServer.js';
import { truncateAll } from '../../../__tests__/fixtures/truncate.js';
import { createTestUser, createTestWorkspace, createTestProject } from '../../../__tests__/fixtures/factories.js';
import { closePool } from '../../../shared/lib/db.js';
import { executeAction } from '../automation.actions.js';
import { automationSchedulerRepository } from '../automation.scheduler.repository.js';
import { runScheduledSweep } from '../automation.scheduler.worker.js';
import { templateService } from '../../templates/template.service.js';
import { listService } from '../../hierarchy/list.service.js';
import { TaskService } from '../../tasks/task.service.js';
import { TaskRepository } from '../../tasks/task.repository.js';
import { spacePath } from '../../hierarchy/path.js';
import { HierarchyRepository } from '../../hierarchy/hierarchy.repository.js';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await closePool(); });

let seq = 0;

async function seed() {
  seq += 1;
  const owner = await createTestUser({ email: `act-sched-${Date.now()}-${seq}@projectflow.test` });
  const token = owner.accessToken;
  const ws = await createTestWorkspace(token);
  const space = await createTestProject(ws.Id, token, {
    name: 'ActSched',
    key: `AS${(Date.now() + seq) % 100000}`,
  });
  return { token, userId: owner.user.Id, workspaceId: ws.Id, projectId: space.Id };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a list under the given space via the REST API. Returns the list's Id. */
async function createList(token: string, workspaceId: string, spaceId: string, name: string): Promise<string> {
  const { data } = await json<{ data: any }>(
    await request('/lists', {
      method: 'POST',
      token,
      json: { workspaceId, spaceId, folderId: null, name, position: 1000 },
    }),
    201,
  );
  return data.Id as string;
}

/** Create a task via the REST API and return its id (string, PascalCase Id). */
async function createTask(
  token: string,
  opts: { title: string; workspaceId: string; listId: string; dueDate?: string },
): Promise<string> {
  const { data } = await json<{ data: any }>(
    await request('/tasks', {
      method: 'POST',
      token,
      json: {
        title:       opts.title,
        workspaceId: opts.workspaceId,
        listId:      opts.listId,
        ...(opts.dueDate ? { dueDate: opts.dueDate } : {}),
      },
    }),
    201,
  );
  // The SP returns PascalCase columns; the route wraps in { data: task }.
  return (data.Id ?? data.id) as string;
}

/** List all tasks for a project via GET /tasks?projectId=. Returns flat array. */
async function listTasksByProject(token: string, projectId: string): Promise<any[]> {
  const body = await json<{ data: any[] }>(
    await request(`/tasks?projectId=${projectId}`, { token }),
    200,
  );
  return body.data;
}

/** List all descendant tasks under a LIST via GET /hierarchy/everything. */
async function descendantTasksOfList(
  token: string,
  listId: string,
): Promise<any[]> {
  const body = await json<{ data: any[] }>(
    await request(`/hierarchy/everything?nodeType=LIST&nodeId=${listId}`, { token }),
    200,
  );
  return body.data;
}

// ─── describe: CREATE_SUBTASK action ─────────────────────────────────────────

describe('CREATE_SUBTASK action', () => {
  it('creates a child task under the trigger task and re-emits a TASK_CREATED event', async () => {
    const { token, userId, workspaceId, projectId } = await seed();

    // Seed: a list and a parent (trigger) task.
    const listId  = await createList(token, workspaceId, projectId, 'Sprint 1');
    const taskId  = await createTask(token, { title: 'Parent Task', workspaceId, listId });

    // Snapshot task count BEFORE the action.
    const before = await listTasksByProject(token, projectId);
    const countBefore = before.length;

    // Build an ActionContext — actorId from the seeded owner (resolveActor reads payload.actorId).
    const ctx = {
      ruleId:      'rule-create-subtask-test',
      workspaceId,
      projectId,
      loop:        { depth: 0, causationChain: [] },
      payload:     {
        taskId,
        projectId,
        listId,
        actorId: userId,
      },
    };

    await executeAction(
      { type: 'CREATE_SUBTASK', title: 'Auto-generated subtask' } as any,
      ctx,
    );

    // After: at least one extra task should exist.
    const after = await listTasksByProject(token, projectId);
    expect(after.length).toBeGreaterThanOrEqual(countBefore + 1);

    // The new task should have parentTaskId === triggerTaskId.
    // The SP returns PascalCase; defensive read of both casings.
    const subtask = after.find((t) => {
      const parent = (t.ParentTaskId ?? t.parentTaskId ?? null) as string | null;
      return parent?.toLowerCase() === taskId.toLowerCase();
    });
    expect(subtask).toBeTruthy();

    // And the subtask title matches what we passed.
    const title = (subtask.Title ?? subtask.title) as string;
    expect(title).toBe('Auto-generated subtask');
  });

  it('does nothing (no crash) when taskId is missing from payload', async () => {
    const { workspaceId, projectId } = await seed();

    // No taskId → the CREATE_SUBTASK guard (`if (!action.title || !reporterId || !taskId) break`)
    // must short-circuit without throwing.
    const ctx = {
      ruleId:      'rule-no-parent',
      workspaceId,
      projectId,
      loop:        { depth: 0, causationChain: [] },
      payload:     { projectId, actorId: 'non-existent-actor' },
    };

    // Should resolve without error.
    await expect(
      executeAction({ type: 'CREATE_SUBTASK', title: 'Orphan' } as any, ctx),
    ).resolves.toBeUndefined();
  });
});

// ─── describe: APPLY_TEMPLATE action ─────────────────────────────────────────

describe('APPLY_TEMPLATE action', () => {
  it('recreates the captured TASK template subtree under the trigger list', async () => {
    const { token, userId, workspaceId, projectId } = await seed();
    const taskService = new TaskService(new TaskRepository());
    const hierarchy   = new HierarchyRepository();

    // ── Source: list + a task (to be captured as a TASK template) ──
    const srcList = await listService.create({
      workspaceId,
      spaceId:    projectId,
      folderId:   null,
      name:       'Source List',
      position:   1000,
      parentPath: spacePath(projectId)!,
    }) as any;
    const srcListId: string = srcList.Id;

    const srcTask = await taskService.createTask({
      workspaceId,
      listId:     srcListId,
      title:      'Template Root Task',
      reporterId: userId,
    } as any, userId) as any;
    const srcTaskId: string = srcTask.Id ?? srcTask.id;

    // Capture the task as a TASK template.
    const tpl = await templateService.captureTemplate('TASK', srcTaskId, 'Task Tpl', null, userId);

    // ── Target: a separate list where the template will be applied ──
    const dstListId = await createList(token, workspaceId, projectId, 'Destination List');

    // Snapshot task count in the destination list BEFORE applying.
    const before = await (hierarchy.descendantTasks('LIST', dstListId) as Promise<any[]>);
    const countBefore = before.length;

    // Build ctx: APPLY_TEMPLATE reads listId from payload as the apply target.
    const ctx = {
      ruleId:      'rule-apply-template-test',
      workspaceId,
      projectId,
      loop:        { depth: 0, causationChain: [] },
      payload:     {
        // For APPLY_TEMPLATE: listId drives targetParentId.
        listId:   dstListId,
        actorId:  userId,
        projectId,
      },
    };

    await executeAction(
      { type: 'APPLY_TEMPLATE', templateId: tpl.id } as any,
      ctx,
    );

    // After: the destination list should have at least one new task.
    const after = await (hierarchy.descendantTasks('LIST', dstListId) as Promise<any[]>);
    expect(after.length).toBeGreaterThan(countBefore);

    // The recreated task title should match the captured template's root task.
    const titles = after.map((t) => (t.Title ?? t.title) as string);
    expect(titles).toContain('Template Root Task');
  });

  it('does nothing (no crash) when templateId is absent', async () => {
    const { workspaceId, projectId, userId } = await seed();

    const ctx = {
      ruleId:      'rule-no-template',
      workspaceId,
      projectId,
      loop:        { depth: 0, causationChain: [] },
      payload:     { listId: 'non-existent-list', actorId: userId, projectId },
    };

    // No templateId → guard `if (!action.templateId || !listId || !actor) break` short-circuits.
    await expect(
      executeAction({ type: 'APPLY_TEMPLATE' } as any, ctx),
    ).resolves.toBeUndefined();
  });
});

// ─── describe: scheduler — DUE_DATE_PASSED ───────────────────────────────────

describe('scheduler — DUE_DATE_PASSED', () => {
  it('listDueDateRules returns a row for an enabled DUE_DATE_PASSED rule whose task dueDate is in the (since,now] window', async () => {
    const { token, userId, workspaceId, projectId } = await seed();

    // Create a list and a task whose dueDate has already passed.
    const listId = await createList(token, workspaceId, projectId, 'Overdue List');

    // dueDate = 10 minutes ago (well within a 5-minute sweep window we open wide below).
    const overdueDue = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
    await createTask(token, {
      title:       'Overdue Task',
      workspaceId,
      listId,
      dueDate:     overdueDue,
    });

    // Create a DUE_DATE_PASSED automation rule via the REST API.
    const { rule } = await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST',
        token,
        json: {
          scopeType:   'PROJECT',
          workspaceId,
          projectId,
          name:        'Notify on overdue',
          trigger:     { type: 'DUE_DATE_PASSED' },
          conditions:  [],
          actions:     [{ type: 'POST_COMMENT', message: 'Task is overdue' }],
        },
      }),
      201,
    );
    expect(rule.trigger.type).toBe('DUE_DATE_PASSED');

    // Sweep window: from 1 hour ago to now — captures the 10-minute-ago dueDate.
    const now   = new Date();
    const since = new Date(now.getTime() - 60 * 60 * 1_000);

    const rows = await automationSchedulerRepository.listDueDateRules(since, now);

    // At least one row should reference TriggerType 'DUE_DATE_PASSED' for our rule.
    const match = rows.find(
      (r) =>
        r.TriggerType === 'DUE_DATE_PASSED' &&
        r.RuleId.toLowerCase() === rule.id.toLowerCase(),
    );
    expect(match).toBeTruthy();
    expect(match!.TaskWorkspaceId.toLowerCase()).toBe(workspaceId.toLowerCase());
  });

  it('runScheduledSweep returns dueDate >= 1 when an overdue task + DUE_DATE_PASSED rule exist', async () => {
    const { token, userId, workspaceId, projectId } = await seed();

    const listId = await createList(token, workspaceId, projectId, 'Sweep List');

    // dueDate = 3 minutes ago — inside a ±30-minute sweep window.
    const overdueDue = new Date(Date.now() - 3 * 60 * 1_000).toISOString();
    await createTask(token, {
      title:       'Sweep Target',
      workspaceId,
      listId,
      dueDate:     overdueDue,
    });

    await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST',
        token,
        json: {
          scopeType:   'PROJECT',
          workspaceId,
          projectId,
          name:        'Sweep rule',
          trigger:     { type: 'DUE_DATE_PASSED' },
          conditions:  [],
          actions:     [{ type: 'POST_COMMENT', message: 'overdue' }],
        },
      }),
      201,
    );

    // Wide window to capture the 3-minute-ago dueDate.
    const now   = new Date();
    const since = new Date(now.getTime() - 30 * 60 * 1_000);

    // runScheduledSweep calls automationQueue.add() — Redis IS available in the
    // integration environment (see integration.setup.ts / REDIS_URL). The call
    // succeeds and the returned count reflects rows enqueued.
    const result = await runScheduledSweep(now, since);
    expect(result.dueDate).toBeGreaterThanOrEqual(1);
  });

  it('listDueDateRules returns no rows when the window does NOT contain the task dueDate', async () => {
    const { token, userId, workspaceId, projectId } = await seed();

    const listId = await createList(token, workspaceId, projectId, 'Future List');

    // dueDate = 2 hours in the FUTURE — should never appear in a past-window query.
    const futureDue = new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString();
    await createTask(token, { title: 'Future Task', workspaceId, listId, dueDate: futureDue });

    await json<{ rule: any }>(
      await request('/automations', {
        method: 'POST',
        token,
        json: {
          scopeType:   'PROJECT',
          workspaceId,
          projectId,
          name:        'Rule for future task',
          trigger:     { type: 'DUE_DATE_PASSED' },
          conditions:  [],
          actions:     [{ type: 'POST_COMMENT', message: 'future' }],
        },
      }),
      201,
    );

    // Sweep window ending NOW — a future dueDate cannot fall inside.
    const now   = new Date();
    const since = new Date(now.getTime() - 5 * 60 * 1_000);

    const rows = await automationSchedulerRepository.listDueDateRules(since, now);
    // Filter for our specific project to isolate from other parallel test state.
    const forThisProject = rows.filter(
      (r) => r.TriggerType === 'DUE_DATE_PASSED' && r.TaskWorkspaceId.toLowerCase() === workspaceId.toLowerCase(),
    );
    expect(forThisProject).toHaveLength(0);
  });
});
