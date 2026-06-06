import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { recurrenceService, InvalidRecurrenceRuleError } from '../modules/recurrence/recurrence.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { TaskRecurrence } from '@projectflow/types';

const taskRepo = new TaskRepository();
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

export function registerRecurrenceGraphql(): void {
  // The rule is transported as a JSON string (mirrors SavedView.config), keeping
  // the schema flat and avoiding a deep input/output type for the RRULE-ish rule.
  const TaskRecurrenceType = builder.objectRef<TaskRecurrence>('TaskRecurrence');
  TaskRecurrenceType.implement({ fields: (t) => ({
    id:                  t.exposeString('id'),
    taskId:              t.exposeString('taskId'),
    workspaceId:         t.exposeString('workspaceId'),
    rule:               t.string({ resolve: (r) => JSON.stringify(r.rule) }),
    regenerateMode:      t.exposeString('regenerateMode'),
    nextRunAt:           t.field({ type: 'Date', nullable: true, resolve: (r) => (r.nextRunAt ? new Date(r.nextRunAt) : null) }),
    active:              t.boolean({ resolve: (r) => r.active }),
    lastSpawnedTaskId:   t.string({ nullable: true, resolve: (r) => r.lastSpawnedTaskId ?? null }),
    includeDependencies: t.boolean({ resolve: (r) => r.includeDependencies }),
  }) });

  builder.queryFields((t) => ({
    taskRecurrence: t.field({
      type: TaskRecurrenceType,
      nullable: true,
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return recurrenceService.getForTask(a.taskId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    setTaskRecurrence: t.field({
      type: TaskRecurrenceType,
      args: {
        taskId:              t.arg.string({ required: true }),
        rule:                t.arg.string({ required: true }), // JSON string
        regenerateMode:      t.arg.string({ required: true }),
        includeDependencies: t.arg.boolean({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        let parsedRule: unknown;
        try { parsedRule = JSON.parse(a.rule); }
        catch { throw new GraphQLError('rule must be a JSON object string', { extensions: { code: 'INVALID_RECURRENCE_RULE' } }); }
        try {
          return await recurrenceService.setForTask(a.taskId, {
            rule: parsedRule,
            regenerateMode: a.regenerateMode,
            includeDependencies: a.includeDependencies ?? false,
          });
        } catch (err: any) {
          if (err instanceof InvalidRecurrenceRuleError)
            throw new GraphQLError(err.message, { extensions: { code: err.code } });
          if (err?.number === 51700)
            throw new GraphQLError('Task not found', { extensions: { code: 'NOT_FOUND' } });
          if (err?.number === 51701)
            throw new GraphQLError('Workspace mismatch', { extensions: { code: 'WORKSPACE_MISMATCH' } });
          throw err;
        }
      },
    }),
    clearTaskRecurrence: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        await recurrenceService.clear(a.taskId);
        return true;
      },
    }),
  }));
}
