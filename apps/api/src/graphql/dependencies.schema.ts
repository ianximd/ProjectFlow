import { builder } from './builder.js';
import { dependencyService } from '../modules/dependencies/dependency.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { DependencyRelation, TaskDependencyRef, TaskDependencyLists } from '@projectflow/types';

const taskRepo = new TaskRepository();
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

function relationOf(raw: string | null | undefined): DependencyRelation {
  return raw === 'blocking' ? 'blocking' : 'waiting_on';
}

export function registerDependenciesGraphql(): void {
  const TaskDependencyRefType = builder.objectRef<TaskDependencyRef>('TaskDependencyRef');
  TaskDependencyRefType.implement({ fields: (t) => ({
    taskId:   t.exposeString('taskId'),
    title:    t.exposeString('title'),
    status:   t.exposeString('status'),
    issueKey: t.string({ nullable: true, resolve: (r) => r.issueKey ?? null }),
  }) });

  const TaskDependencyListsType = builder.objectRef<TaskDependencyLists>('TaskDependencyLists');
  TaskDependencyListsType.implement({ fields: (t) => ({
    waitingOn: t.field({ type: [TaskDependencyRefType], resolve: (l) => l.waitingOn }),
    blocking:  t.field({ type: [TaskDependencyRefType], resolve: (l) => l.blocking }),
  }) });

  builder.queryFields((t) => ({
    taskDependencies: t.field({
      type: TaskDependencyListsType,
      args: { taskId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        return dependencyService.list(a.taskId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    addTaskDependency: t.field({
      type: TaskDependencyListsType,
      args: {
        taskId:      t.arg.string({ required: true }),
        dependsOnId: t.arg.string({ required: true }),
        relation:    t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        // Cross-workspace IDOR guard: dependsOn must live in the same workspace.
        // A missing/foreign target is reported as NOT_FOUND (fail-closed, no leak).
        const depWs = await taskRepo.getWorkspaceId(a.dependsOnId);
        if (!depWs || depWs !== workspaceId) notFound('Task not found');
        await dependencyService.add(a.taskId, a.dependsOnId, relationOf(a.relation), workspaceId);
        return dependencyService.list(a.taskId);
      },
    }),
    removeTaskDependency: t.field({
      type: TaskDependencyListsType,
      args: {
        taskId:      t.arg.string({ required: true }),
        dependsOnId: t.arg.string({ required: true }),
        relation:    t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        await dependencyService.remove(a.taskId, a.dependsOnId, relationOf(a.relation));
        return dependencyService.list(a.taskId);
      },
    }),
  }));
}
