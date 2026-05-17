import { Hono } from 'hono';
import { attachmentService } from './attachment.service.js';
import { AttachmentRepository } from './attachment.repository.js';
import { TaskRepository } from '../tasks/task.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

export const attachmentRoutes = new Hono();

// RBAC resolvers
const attachmentRepoForLookup = new AttachmentRepository();
const taskRepoForLookup       = new TaskRepository();

async function loadAttachmentContext(c: any): Promise<{ workspaceId: string; ownerId: string } | null> {
  const cached = c.get('attachmentContext') as { workspaceId: string; ownerId: string } | null | undefined;
  if (cached !== undefined) return cached;
  const ctx = await attachmentRepoForLookup.getContext(c.req.param('id')!);
  c.set('attachmentContext', ctx);
  return ctx;
}
const resolveAttachmentWorkspace = async (c: any) => (await loadAttachmentContext(c))?.workspaceId ?? null;
const resolveAttachmentOwner     = async (c: any) => (await loadAttachmentContext(c))?.ownerId ?? null;

// POST /attachments — multipart. Parse the body once, cache it on the
// context, and let both the resolver and the handler read from there so we
// don't try to read the multipart stream twice.
async function resolveTaskWorkspaceFromMultipart(c: any): Promise<string | null> {
  let body = c.get('parsedMultipart') as Record<string, any> | undefined;
  if (!body) {
    try { body = await c.req.parseBody(); }
    catch { return null; }
    c.set('parsedMultipart', body);
  }
  const taskId = body!['taskId'] as string | undefined;
  return taskId ? await taskRepoForLookup.getWorkspaceId(taskId) : null;
}

// GET /api/v1/attachments?taskId=
attachmentRoutes.get('/', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ error: { message: 'taskId is required' } }, 400);

  const attachments = await attachmentService.list(taskId);
  return c.json({ data: attachments });
});

// POST /api/v1/attachments  (multipart/form-data: file + taskId)
attachmentRoutes.post(
  '/',
  requirePermission('attachment.create', { resolveWorkspace: resolveTaskWorkspaceFromMultipart }),
  async (c) => {
  const user = (c as any).get('user') as any;

  // The RBAC middleware already parsed the body; reuse it if present.
  let body = (c as any).get('parsedMultipart') as Record<string, any> | undefined;
  if (!body) {
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ error: { message: 'Invalid multipart body' } }, 400);
    }
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

// GET /api/v1/attachments/:id/download → JSON { data: { url } }
// Returns the presigned URL rather than a 302 so the frontend can present it
// with the Bearer token in an Authorization header; an <a href> from the
// browser wouldn't carry the in-memory access token and would 401.
attachmentRoutes.get('/:id/download', async (c) => {
  const url = await attachmentService.getDownloadUrl(c.req.param('id'));
  if (!url) return c.json({ error: { message: 'Attachment not found' } }, 404);
  return c.json({ data: { url } });
});

// DELETE /api/v1/attachments/:id  — admins (.any) or the uploader (.own)
attachmentRoutes.delete(
  '/:id',
  requirePermission('attachment.delete.any', {
    resolveWorkspace: resolveAttachmentWorkspace,
    ownerFallback: { slug: 'attachment.delete.own', resolveOwner: resolveAttachmentOwner },
  }),
  async (c) => {
  const user    = (c as any).get('user') as any;
  const deleted = await attachmentService.delete(c.req.param('id')!, user.userId);
  if (!deleted) return c.json({ error: { message: 'Attachment not found or not yours' } }, 404);
  return c.body(null, 204);
});
