import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { WorkLogService } from '../modules/worklogs/worklog.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import { assertAppEnabled } from './apps.schema.js';
import { appService } from '../modules/apps/app.service.js';
import type { WorkLog, TaskTimeRollup } from '@projectflow/types';

const svc = new WorkLogService();
const taskRepo = new TaskRepository();

// A task's List drives the object-level VIEW gate (mirrors recurrence.schema.ts).
// usp_Task_GetById returns either camelCase `listId` or PascalCase `ListId` —
// read both defensively.
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

/**
 * GraphQL mirror of the WorkLog REST surface (Phase 8a — Time Tracking).
 * REST stays primary; both delegate to the SAME WorkLogService. Read paths gate
 * on object-level VIEW of the task's List; write paths gate on the
 * `worklog.create` workspace permission (mirroring the REST routes).
 */
export function registerWorkLogGraphql(): void {
  // The WorkLog row carries `user: WorkLogUser` and `source: WorkLogSource`
  // (a union). We expose a flat projection here; `source` uses t.string because
  // exposeString rejects the union literal type.
  const WorkLogType = builder.objectRef<WorkLog>('WorkLog');
  WorkLogType.implement({ fields: (t) => ({
    id:               t.exposeString('id'),
    taskId:           t.exposeString('taskId'),
    timeSpentSeconds: t.exposeInt('timeSpentSeconds'),
    startedAt:        t.field({ type: 'Date', resolve: (w) => new Date(w.startedAt) }),
    endedAt:          t.field({ type: 'Date', nullable: true, resolve: (w) => (w.endedAt ? new Date(w.endedAt) : null) }),
    billable:         t.boolean({ resolve: (w) => w.billable }),
    source:           t.string({ resolve: (w) => w.source }),
    description:      t.string({ nullable: true, resolve: (w) => w.description ?? null }),
    createdAt:        t.field({ type: 'Date', resolve: (w) => new Date(w.createdAt) }),
  }) });

  const RollupType = builder.objectRef<TaskTimeRollup>('TaskTimeRollup');
  RollupType.implement({ fields: (t) => ({
    taskId:                t.exposeString('taskId'),
    ownLoggedSeconds:      t.exposeInt('ownLoggedSeconds'),
    ownEstimateSeconds:    t.int({ nullable: true, resolve: (r) => r.ownEstimateSeconds ?? null }),
    rollupLoggedSeconds:   t.exposeInt('rollupLoggedSeconds'),
    rollupEstimateSeconds: t.exposeInt('rollupEstimateSeconds'),
  }) });

  builder.queryFields((t) => ({
    /** Work logs for a task (VIEW on the task's List). */
    taskWorkLogs: t.field({
      type: [WorkLogType],
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        await assertAppEnabled('time_tracking', await appService.scopeNodeForTask(a.taskId));
        return (await svc.listByTask(a.taskId)).logs;
      },
    }),
    /** The authenticated user's currently-running timer, or null. */
    activeTimer: t.field({
      type: WorkLogType,
      nullable: true,
      resolve: async (_, __, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        return svc.getActiveTimer((ctx.user as any).userId);
      },
    }),
    /** Own + subtree-rolled time aggregates for a task (VIEW on its List). */
    taskTimeRollup: t.field({
      type: RollupType,
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        await assertAppEnabled('time_tracking', await appService.scopeNodeForTask(a.taskId));
        return svc.getRollup(a.taskId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    /** Start a timer on a task (worklog.create). */
    startTimer: t.field({
      type: WorkLogType,
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        await requireWorkspacePermission(ctx, workspaceId, 'worklog.create');
        await assertAppEnabled('time_tracking', await appService.scopeNodeForTask(a.taskId));
        return svc.startTimer(a.taskId, (ctx.user as any).userId);
      },
    }),
    /** Stop the caller's running timer (returns the finalized log, or null). */
    stopTimer: t.field({
      type: WorkLogType,
      nullable: true,
      resolve: async (_, __, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        return svc.stopTimer((ctx.user as any).userId);
      },
    }),
    /** Create a manual work log on a task (worklog.create). */
    createWorkLog: t.field({
      type: WorkLogType,
      args: {
        taskId:           t.arg.string({ required: true }),
        timeSpentSeconds: t.arg.int({ required: true }),
        startedAt:        t.arg.string({ required: true }),
        endedAt:          t.arg.string({ required: false }),
        description:      t.arg.string({ required: false }),
        billable:         t.arg.boolean({ required: false }),
        source:           t.arg.string({ required: false }),
        tagIds:           t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        await requireWorkspacePermission(ctx, workspaceId, 'worklog.create');
        await assertAppEnabled('time_tracking', await appService.scopeNodeForTask(a.taskId));
        return svc.create(a.taskId, (ctx.user as any).userId, a.timeSpentSeconds, a.startedAt, {
          endedAt: a.endedAt ?? undefined, description: a.description ?? undefined,
          billable: a.billable ?? undefined, source: (a.source as any) ?? undefined,
          tagIds: a.tagIds ?? undefined,
        });
      },
    }),
    /** Patch a work log (the WorkLogService enforces author ownership). */
    // time_tracking gate is enforced on the REST path; a GraphQL parity gate
    // (resolving the task/scope from the worklog id) is a documented follow-up.
    updateWorkLog: t.field({
      type: WorkLogType,
      nullable: true,
      args: {
        id:               t.arg.string({ required: true }),
        timeSpentSeconds: t.arg.int({ required: false }),
        startedAt:        t.arg.string({ required: false }),
        description:      t.arg.string({ required: false }),
        billable:         t.arg.boolean({ required: false }),
        tagIds:           t.arg.stringList({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        return svc.update(a.id, (ctx.user as any).userId, {
          timeSpentSeconds: a.timeSpentSeconds ?? undefined, startedAt: a.startedAt ?? undefined,
          description: a.description ?? undefined, billable: a.billable ?? undefined,
          tagIds: a.tagIds ?? undefined,
        });
      },
    }),
    /** Delete a work log (the WorkLogService enforces author ownership). */
    // time_tracking gate is enforced on the REST path; a GraphQL parity gate
    // (resolving the task/scope from the worklog id) is a documented follow-up.
    deleteWorkLog: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
        await svc.delete(a.id, (ctx.user as any).userId);
        return true;
      },
    }),
  }));
}
