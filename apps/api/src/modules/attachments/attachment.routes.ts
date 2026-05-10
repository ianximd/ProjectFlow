import { Hono } from 'hono';
import { attachmentService } from './attachment.service.js';

export const attachmentRoutes = new Hono();

// GET /api/v1/attachments?taskId=
attachmentRoutes.get('/', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ error: { message: 'taskId is required' } }, 400);

  const attachments = await attachmentService.list(taskId);
  return c.json({ data: attachments });
});

// POST /api/v1/attachments  (multipart/form-data: file + taskId)
attachmentRoutes.post('/', async (c) => {
  const user = (c as any).get('user') as any;

  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: { message: 'Invalid multipart body' } }, 400);
  }

  const taskId = body['taskId'] as string | undefined;
  const file   = body['file'] as File | undefined;

  if (!taskId || !file) {
    return c.json({ error: { message: 'taskId and file are required' } }, 400);
  }

  // Convert Web API File → Buffer
  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer  = Buffer.from(arrayBuffer);

  try {
    const attachment = await attachmentService.upload({
      taskId,
      uploadedById: user.userId,
      fileName:     file.name,
      fileBuffer,
      mimeType:     file.type || 'application/octet-stream',
    });
    return c.json({ data: attachment }, 201);
  } catch (err: any) {
    if (err.code === 'FILE_TOO_LARGE') {
      return c.json({ error: { message: 'File exceeds 25 MB limit' } }, 413);
    }
    if (err.code === 'INVALID_MIME') {
      return c.json({ error: { message: 'File type not allowed' } }, 415);
    }
    return c.json({ error: { message: 'Upload failed' } }, 500);
  }
});

// GET /api/v1/attachments/:id/download  → redirects to presigned URL
attachmentRoutes.get('/:id/download', async (c) => {
  const url = await attachmentService.getDownloadUrl(c.req.param('id'));
  if (!url) return c.json({ error: { message: 'Attachment not found' } }, 404);
  return c.redirect(url, 302);
});

// DELETE /api/v1/attachments/:id
attachmentRoutes.delete('/:id', async (c) => {
  const user    = (c as any).get('user') as any;
  const deleted = await attachmentService.delete(c.req.param('id'), user.userId);
  if (!deleted) return c.json({ error: { message: 'Attachment not found or not yours' } }, 404);
  return c.body(null, 204);
});
