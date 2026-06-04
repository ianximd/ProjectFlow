import { builder } from './builder.js';
import { tagService } from '../modules/tags/tag.service.js';
import { ProjectRepository } from '../modules/projects/project.repository.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { requireObjectLevel, requireWorkspacePermission } from './authz.js';
import type { Tag } from '@projectflow/types';

const projectRepo = new ProjectRepository();
const taskRepo = new TaskRepository();

export function registerTagsGraphql(): void {
  const TagType = builder.objectRef<Tag>('Tag');
  TagType.implement({ fields: (t) => ({
    id: t.exposeString('id'),
    projectId: t.exposeString('projectId'),
    name: t.exposeString('name'),
    color: t.exposeString('color'),
    issueCount: t.exposeInt('issueCount'),
  }) });

  builder.queryFields((t) => ({
    spaceTags: t.field({
      type: [TagType],
      args: { spaceId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireObjectLevel(ctx, 'SPACE', a.spaceId, 'VIEW');
        return tagService.list(a.spaceId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createTag: t.field({
      type: TagType,
      args: {
        spaceId: t.arg.string({ required: true }),
        name: t.arg.string({ required: true }),
        color: t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await projectRepo.getWorkspaceId(a.spaceId), 'label.manage');
        return tagService.create(a.spaceId, a.name, a.color ?? null);
      },
    }),
    deleteTag: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await tagService.getWorkspaceId(a.id), 'label.manage');
        await tagService.delete(a.id); return true;
      },
    }),
    linkTag: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), tagId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        await tagService.linkTask(a.taskId, a.tagId); return true;
      },
    }),
    unlinkTag: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), tagId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireWorkspacePermission(ctx, await taskRepo.getWorkspaceId(a.taskId), 'task.update');
        await tagService.unlinkTask(a.taskId, a.tagId); return true;
      },
    }),
  }));
}
