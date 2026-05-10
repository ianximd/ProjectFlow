import { Hono } from 'hono';
import { commentService } from './comment.service.js';

export const commentRoutes = new Hono();

// GET /api/v1/comments?taskId=
commentRoutes.get('/', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ error: { message: 'taskId is required' } }, 400);
  const comments = await commentService.list(taskId);
  return c.json({ data: comments });
});

// POST /api/v1/comments
commentRoutes.post('/', async (c) => {
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

// PATCH /api/v1/comments/:id
commentRoutes.patch('/:id', async (c) => {
  const { body } = await c.req.json();
  const user = (c as any).get('user') as any;

  if (!body?.trim()) return c.json({ error: { message: 'body is required' } }, 400);

  const comment = await commentService.update(c.req.param('id'), body, user.userId);
  if (!comment) return c.json({ error: { message: 'Comment not found or not yours' } }, 404);
  return c.json({ data: comment });
});

// DELETE /api/v1/comments/:id
commentRoutes.delete('/:id', async (c) => {
  const user = (c as any).get('user') as any;
  const deleted = await commentService.delete(c.req.param('id'), user.userId);
  if (!deleted) return c.json({ error: { message: 'Comment not found or not yours' } }, 404);
  return c.body(null, 204);
});

// POST /api/v1/comments/:id/reactions
commentRoutes.post('/:id/reactions', async (c) => {
  const { emoji } = await c.req.json();
  const user = (c as any).get('user') as any;

  if (!emoji?.trim()) return c.json({ error: { message: 'emoji is required' } }, 400);

  try {
    const reactions = await commentService.react(c.req.param('id'), user.userId, emoji);
    return c.json({ data: reactions });
  } catch (err: any) {
    return c.json({ error: { message: 'Internal Server Error' } }, 500);
  }
});
