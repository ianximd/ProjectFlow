import { Hono } from 'hono';
import { commentService } from './comment.service.js';
import { CommentRepository } from './comment.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

export const commentRoutes = new Hono();

// Repos used only by RBAC resolvers (cheap to instantiate; per-call SP).
const commentRepoForLookup = new CommentRepository();
const taskRepoForLookup    = new TaskRepository();

// For routes acting on /comments/:id — resolve workspace AND owner from the
// same SP call. The result is cached on the context so PATCH/DELETE handlers
// pay one round-trip even if both ownerOnly and resolveWorkspace fire.
async function loadCommentContext(c: any): Promise<{ workspaceId: string; ownerId: string } | null> {
  const cached = c.get('commentContext') as { workspaceId: string; ownerId: string } | null | undefined;
  if (cached !== undefined) return cached;
  const ctx = await commentRepoForLookup.getContext(c.req.param('id')!);
  c.set('commentContext', ctx);
  return ctx;
}
const resolveCommentWorkspace = async (c: any) => (await loadCommentContext(c))?.workspaceId ?? null;
const resolveCommentOwner     = async (c: any) => (await loadCommentContext(c))?.ownerId ?? null;

// For POST /comments — derive workspace from body.taskId via the task SP.
async function resolveTaskWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return body?.taskId ? await taskRepoForLookup.getWorkspaceId(body.taskId) : null;
  } catch {
    return null;
  }
}

// GET /api/v1/comments?taskId=
commentRoutes.get('/', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ error: { message: 'taskId is required' } }, 400);
  const comments = await commentService.list(taskId);
  return c.json({ data: comments });
});

// POST /api/v1/comments
commentRoutes.post(
  '/',
  requirePermission('comment.create', { resolveWorkspace: resolveTaskWorkspaceFromBody }),
  async (c) => {
  const body = await c.req.json();
  const user = (c as any).get('user') as any;

  if (!body.taskId || !body.body?.trim()) {
    return c.json({ error: { message: 'taskId and body are required' } }, 400);
  }

  try {
    const comment = await commentService.create(
      { taskId: body.taskId, body: body.body, parentId: body.parentId ?? null },
      user.userId,
    );
    return c.json({ data: comment }, 201);
  } catch (err: any) {
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});

// PATCH /api/v1/comments/:id  — owner-only (no .any perm exists for update)
commentRoutes.patch(
  '/:id',
  requirePermission('comment.update.own', {
    resolveWorkspace: resolveCommentWorkspace,
    ownerOnly: resolveCommentOwner,
  }),
  async (c) => {
  const { body } = await c.req.json();
  const user = (c as any).get('user') as any;

  if (!body?.trim()) return c.json({ error: { message: 'body is required' } }, 400);

  const comment = await commentService.update(c.req.param('id')!, body, user.userId);
  if (!comment) return c.json({ error: { message: 'Comment not found or not yours' } }, 404);
  return c.json({ data: comment });
});

// POST /api/v1/comments/:id/assign  { assigneeId }
commentRoutes.post(
  '/:id/assign',
  requirePermission('task.update', {
    resolveWorkspace: resolveCommentWorkspace,
    ownerFallback: { slug: 'comment.update.own', resolveOwner: resolveCommentOwner },
  }),
  async (c) => {
    const user = (c as any).get('user') as any;
    const body = await c.req.json();
    if (!body?.assigneeId || typeof body.assigneeId !== 'string')
      return c.json({ error: { code: 'BAD_REQUEST', message: 'assigneeId is required' } }, 400);
    try {
      const comment = await commentService.assign(c.req.param('id')!, body.assigneeId, user.userId);
      if (!comment) return c.json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);
      return c.json({ data: comment });
    } catch (err: any) {
      if (String(err?.message).includes('51403') || err?.number === 51403)
        return c.json({ error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
      if (String(err?.message).includes('51401') || err?.number === 51401)
        return c.json({ error: { code: 'ASSIGNEE_NOT_MEMBER', message: 'Assignee is not a member of the workspace' } }, 422);
      if (String(err?.message).includes('51400') || err?.number === 51400)
        return c.json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);
      throw err;
    }
  },
);

// POST /api/v1/comments/:id/resolve  { resolved }
commentRoutes.post(
  '/:id/resolve',
  requirePermission('task.update', {
    resolveWorkspace: resolveCommentWorkspace,
    ownerFallback: { slug: 'comment.update.own', resolveOwner: resolveCommentOwner },
  }),
  async (c) => {
    const user = (c as any).get('user') as any;
    const body = await c.req.json();
    try {
      const comment = await commentService.resolve(c.req.param('id')!, user.userId, Boolean(body.resolved));
      if (!comment) return c.json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);
      return c.json({ data: comment });
    } catch (err: any) {
      if (String(err?.message).includes('51403') || err?.number === 51403)
        return c.json({ error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
      if (String(err?.message).includes('51402') || err?.number === 51402)
        return c.json({ error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);
      throw err;
    }
  },
);

// DELETE /api/v1/comments/:id  — admins (.any) or the author (.own)
commentRoutes.delete(
  '/:id',
  requirePermission('comment.delete.any', {
    resolveWorkspace: resolveCommentWorkspace,
    ownerFallback: { slug: 'comment.delete.own', resolveOwner: resolveCommentOwner },
  }),
  async (c) => {
  const user = (c as any).get('user') as any;
  const deleted = await commentService.delete(c.req.param('id')!, user.userId);
  if (!deleted) return c.json({ error: { message: 'Comment not found or not yours' } }, 404);
  return c.body(null, 204);
});

// POST /api/v1/comments/:id/reactions — anyone with comment.create can react
commentRoutes.post(
  '/:id/reactions',
  requirePermission('comment.create', { resolveWorkspace: resolveCommentWorkspace }),
  async (c) => {
  const { emoji } = await c.req.json();
  const user = (c as any).get('user') as any;

  if (!emoji?.trim()) return c.json({ error: { message: 'emoji is required' } }, 400);

  try {
    const reactions = await commentService.react(c.req.param('id')!, user.userId, emoji);
    return c.json({ data: reactions });
  } catch (err: any) {
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});
