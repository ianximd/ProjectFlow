import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { tagService } from '../modules/tags/tag.service.js';
import type { Tag } from '@projectflow/types';

function requireAuth(ctx: { user: unknown }): asserts ctx is { user: { userId: string } } {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
}

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
      resolve: async (_, a, ctx) => { requireAuth(ctx); return tagService.list(a.spaceId); },
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
      resolve: async (_, a, ctx) => { requireAuth(ctx); return tagService.create(a.spaceId, a.name, a.color ?? null); },
    }),
    deleteTag: t.field({
      type: 'Boolean',
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { requireAuth(ctx); await tagService.delete(a.id); return true; },
    }),
    linkTag: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), tagId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { requireAuth(ctx); await tagService.linkTask(a.taskId, a.tagId); return true; },
    }),
    unlinkTag: t.field({
      type: 'Boolean',
      args: { taskId: t.arg.string({ required: true }), tagId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => { requireAuth(ctx); await tagService.unlinkTask(a.taskId, a.tagId); return true; },
    }),
  }));
}
