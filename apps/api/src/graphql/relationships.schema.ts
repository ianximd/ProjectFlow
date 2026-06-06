import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { relationshipService, RelationshipNotFoundError } from '../modules/relationships/relationship.service.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { notFound, requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { RelationshipRef } from '@projectflow/types';

const taskRepo = new TaskRepository();
async function taskListId(taskId: string): Promise<string | null> {
  const t = await taskRepo.getById(taskId);
  return (t as any)?.listId ?? (t as any)?.ListId ?? null;
}

function mapSpError(err: any): never {
  if (err instanceof RelationshipNotFoundError) notFound('Task not found');
  if (err?.number === 51600) notFound('Relationship field not found');
  if (err?.number === 51601 || err?.number === 51602) notFound('Task not found');
  if (err?.number === 51603) throw new GraphQLError('A task cannot link to itself', { extensions: { code: 'INVALID_RELATIONSHIP' } });
  throw err;
}

export function registerRelationshipsGraphql(): void {
  const RelationshipRefType = builder.objectRef<RelationshipRef>('RelationshipRef');
  RelationshipRefType.implement({ fields: (t) => ({
    taskId:   t.exposeString('taskId'),
    title:    t.exposeString('title'),
    status:   t.exposeString('status'),
    issueKey: t.string({ nullable: true, resolve: (r) => r.issueKey ?? null }),
  }) });

  builder.queryFields((t) => ({
    taskRelationships: t.field({
      type: [RelationshipRefType],
      args: { taskId: t.arg.string({ required: true }), fieldId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'LIST', await taskListId(a.taskId), 'VIEW');
        const workspaceId = await taskRepo.getWorkspaceId(a.taskId);
        if (!workspaceId) notFound('Task not found');
        return relationshipService.list(a.fieldId, a.taskId, workspaceId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    addTaskRelationship: t.field({
      type: [RelationshipRefType],
      args: {
        taskId:   t.arg.string({ required: true }),
        fieldId:  t.arg.string({ required: true }),
        toTaskId: t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        // Cross-workspace IDOR guard: toTask must live in the same workspace.
        const toWs = await taskRepo.getWorkspaceId(a.toTaskId);
        if (!toWs || toWs !== workspaceId) notFound('Task not found');
        try { return await relationshipService.add(a.fieldId, a.taskId, a.toTaskId, workspaceId); }
        catch (err) { mapSpError(err); }
      },
    }),
    removeTaskRelationship: t.field({
      type: [RelationshipRefType],
      args: {
        taskId:   t.arg.string({ required: true }),
        fieldId:  t.arg.string({ required: true }),
        toTaskId: t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        const workspaceId = await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        // Mirror addTaskRelationship: cross-workspace IDOR guard on toTaskId.
        const toWs = await taskRepo.getWorkspaceId(a.toTaskId);
        if (!toWs || toWs !== workspaceId) notFound('Task not found');
        await relationshipService.remove(a.fieldId, a.taskId, a.toTaskId, workspaceId);
        return relationshipService.list(a.fieldId, a.taskId, workspaceId);
      },
    }),
  }));
}
