import { builder } from './builder.js';
import { taskTypeService } from '../modules/tasktypes/tasktype.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireWorkspacePermission } from './authz.js';
import type { TaskType } from '@projectflow/types';

const taskRepo = new TaskRepository();

export function registerTaskTypesGraphql(): void {
  const TaskTypeType = builder.objectRef<TaskType>('TaskType');
  TaskTypeType.implement({ fields: (t) => ({
    id: t.exposeString('id'),
    workspaceId: t.exposeString('workspaceId'),
    nameSingular: t.exposeString('nameSingular'),
    namePlural: t.exposeString('namePlural'),
    icon: t.exposeString('icon', { nullable: true }),
    isMilestone: t.exposeBoolean('isMilestone'),
    isDefault: t.exposeBoolean('isDefault'),
    position: t.exposeFloat('position'),
  }) });

  builder.queryFields((t) => ({
    taskTypes: t.field({
      type: [TaskTypeType],
      args: { workspaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, a.workspaceId, 'workspace.read');
        return taskTypeService.list(a.workspaceId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    setTaskType: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), taskTypeId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        const task = await taskTypeService.setTaskType(a.taskId, a.taskTypeId);
        return task != null;
      },
    }),
  }));
}
