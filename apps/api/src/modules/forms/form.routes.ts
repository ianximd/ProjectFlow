import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../auth/auth.middleware.js';
import { formService } from './form.service.js';
import {
  FormNotFoundError, FormNotPublicError, FormAuthRequiredError, FormValidationError,
} from './form.errors.js';
import { accessService, LEVEL_ORDER } from '../access/access.service.js';
import { isWorkspaceMember } from '../workspaces/membership.js';
import { JWT_SECRET } from '../../shared/lib/jwtSecret.js';
import type { ObjectPermissionLevel } from '@projectflow/types';

export const formRoutes = new Hono();

function getUserId(c: Context): string | null {
  return (c as any).get('user')?.userId ?? null;
}

const SCOPE = z.enum(['SPACE', 'FOLDER', 'LIST']);

const fieldSchema = z.object({
  key:      z.string().min(1).max(64),
  label:    z.string().min(1).max(255),
  type:     z.enum(['short_text', 'long_text', 'number', 'email', 'select', 'multiselect', 'checkbox', 'date']),
  required: z.boolean(),
  options:  z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});
const branchingSchema = z.object({
  fieldKey: z.string().min(1),
  action:   z.enum(['show', 'hide']),
  when: z.object({
    fieldKey: z.string().min(1),
    op:       z.enum(['equals', 'not_equals', 'includes', 'is_empty', 'is_not_empty']),
    value:    z.string().optional(),
  }),
});
const configSchema = z.object({ fields: z.array(fieldSchema), branching: z.array(branchingSchema) });
// zod v4: z.record requires two arguments (key schema + value schema)
const mappingSchema = z.record(z.string(), z.object({ kind: z.enum(['task', 'custom_field']), target: z.string().min(1) }));

const createSchema = z.object({
  workspaceId:  z.string().uuid(),
  scopeType:    SCOPE,
  scopeId:      z.string().uuid(),
  name:         z.string().min(1).max(255),
  config:       configSchema,
  targetListId: z.string().uuid(),
  fieldMapping: mappingSchema,
  templateId:   z.string().uuid().nullable().optional(),
  isPublic:     z.boolean().optional(),
  publicSlug:   z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).nullable().optional(),
  authRequired: z.boolean().optional(),
});
const updateSchema = z.object({
  name:         z.string().min(1).max(255).optional(),
  config:       configSchema.optional(),
  targetListId: z.string().uuid().optional(),
  fieldMapping: mappingSchema.optional(),
  templateId:   z.string().uuid().nullable().optional(),
  isPublic:     z.boolean().optional(),
  publicSlug:   z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).nullable().optional(),
  authRequired: z.boolean().optional(),
});
// zod v4: z.record requires two arguments (key schema + value schema)
const submitSchema = z.object({
  answers:   z.record(z.string(), z.unknown()),
  readToken: z.string().min(1),
});

/** Inline object-level EDIT gate on a hierarchy node (mirrors templates route). */
async function gateObjectEdit(c: Context, type: 'SPACE' | 'FOLDER' | 'LIST', id: string, min: ObjectPermissionLevel = 'EDIT') {
  const userId = getUserId(c)!;
  const { level, found } = await accessService.resolveOrNull(userId, type, id);
  if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, 404);
  if (!level || LEVEL_ORDER[level] < LEVEL_ORDER[min])
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  return null; // ok
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC, UNAUTHENTICATED render + submit. These are the ONLY routes on this
// router that are NOT auth-gated (server.ts deliberately omits the blanket
// authMiddleware for /forms/*). DO NOT add an auth gate here.
// ───────────────────────────────────────────────────────────────────────────

// GET /forms/public/:slug — render a public form (no session).
formRoutes.get('/public/:slug', async (c) => {
  try {
    const view = await formService.renderPublic(c.req.param('slug'));
    return c.json({ data: view });
  } catch (err) {
    if (err instanceof FormNotFoundError || err instanceof FormNotPublicError)
      return c.json({ error: { code: (err as any).code, message: err.message } }, 404);
    throw err;
  }
});

// POST /forms/public/:slug/submit — anonymous OR authed submit.
// Optional auth: if a valid Bearer is present we attribute the submission to
// that user (and AuthRequired forms accept it); otherwise actorId is null.
formRoutes.post('/public/:slug/submit', zValidator('json', submitSchema), async (c) => {
  let actorId: string | null = null;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
      actorId = payload?.userId ?? null;
    } catch { actorId = null; } // invalid token → treated as anonymous
  }
  const { answers, readToken } = c.req.valid('json');
  try {
    const result = await formService.submit(c.req.param('slug'), answers, readToken, actorId);
    return c.json({ data: result }, 201);
  } catch (err) {
    if (err instanceof FormNotFoundError || err instanceof FormNotPublicError)
      return c.json({ error: { code: (err as any).code, message: err.message } }, 404);
    if (err instanceof FormAuthRequiredError)
      return c.json({ error: { code: err.code, message: err.message } }, 401);
    if (err instanceof FormValidationError)
      return c.json({ error: { code: err.code, message: err.message, details: err.detail } }, 422);
    throw err;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PROTECTED CRUD — every handler attaches authMiddleware inline + an ACL gate.
// ───────────────────────────────────────────────────────────────────────────

// POST /forms — EDIT on the form's scope node.
formRoutes.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const b = c.req.valid('json');
  if (!(await isWorkspaceMember(b.workspaceId, getUserId(c)!)))
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  // I1: verify the scope node actually belongs to the declared workspace — a member
  // of workspace A with EDIT on a scope in workspace B must not cross the tenant boundary.
  const resolvedWs = await formService.getScopeWorkspaceId(b.scopeType, b.scopeId);
  if (!resolvedWs)
    return c.json({ error: { code: 'NOT_FOUND', message: 'Scope not found' } }, 404);
  if (b.workspaceId !== resolvedWs)
    return c.json({ error: { code: 'WORKSPACE_MISMATCH', message: 'workspaceId does not match scope' } }, 400);
  const denied = await gateObjectEdit(c, b.scopeType, b.scopeId);
  if (denied) return denied;
  try {
    const form = await formService.create({ ...b, workspaceId: resolvedWs }, getUserId(c)!);
    return c.json({ data: form }, 201);
  } catch (err) {
    const mapped = mapFormSqlError(c, err);
    if (mapped) return mapped;
    throw err;
  }
});

// GET /forms?workspaceId=&scopeType=&scopeId= — workspace-member gated.
const listQuery = z.object({
  workspaceId: z.string().uuid(),
  scopeType:   SCOPE.optional(),
  scopeId:     z.string().uuid().optional(),
});
formRoutes.get('/', authMiddleware, zValidator('query', listQuery), async (c) => {
  const { workspaceId, scopeType, scopeId } = c.req.valid('query');
  if (!(await isWorkspaceMember(workspaceId, getUserId(c)!)))
    return c.json({ error: { code: 'FORBIDDEN', message: 'You do not have access' } }, 403);
  const data = await formService.list(workspaceId, scopeType ?? null, scopeId ?? null);
  return c.json({ data });
});

// GET /forms/:id — VIEW on the form's scope node.
formRoutes.get('/:id', authMiddleware, async (c) => {
  const form = await formService.getById(c.req.param('id')!);
  if (!form) return c.json({ error: { code: 'NOT_FOUND', message: 'Form not found' } }, 404);
  const denied = await gateObjectEdit(c, form.scopeType, form.scopeId, 'VIEW');
  if (denied) return denied;
  return c.json({ data: form });
});

// GET /forms/:id/submissions — VIEW on the form's scope node.
formRoutes.get('/:id/submissions', authMiddleware, async (c) => {
  const form = await formService.getById(c.req.param('id')!);
  if (!form) return c.json({ error: { code: 'NOT_FOUND', message: 'Form not found' } }, 404);
  const denied = await gateObjectEdit(c, form.scopeType, form.scopeId, 'VIEW');
  if (denied) return denied;
  const data = await formService.listSubmissions(form.id);
  return c.json({ data });
});

// PUT /forms/:id — EDIT on the form's scope node.
formRoutes.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const form = await formService.getById(c.req.param('id')!);
  if (!form) return c.json({ error: { code: 'NOT_FOUND', message: 'Form not found' } }, 404);
  const denied = await gateObjectEdit(c, form.scopeType, form.scopeId);
  if (denied) return denied;
  try {
    const updated = await formService.update(form.id, c.req.valid('json'));
    return c.json({ data: updated });
  } catch (err) {
    const mapped = mapFormSqlError(c, err);
    if (mapped) return mapped;
    throw err;
  }
});

// DELETE /forms/:id — EDIT on the form's scope node.
formRoutes.delete('/:id', authMiddleware, async (c) => {
  const form = await formService.getById(c.req.param('id')!);
  if (!form) return c.json({ error: { code: 'NOT_FOUND', message: 'Form not found' } }, 404);
  const denied = await gateObjectEdit(c, form.scopeType, form.scopeId);
  if (denied) return denied;
  const deleted = await formService.delete(form.id);
  return c.json({ data: deleted });
});

// ─── SQL error mapper (create + update only) ────────────────────────────────
// SP raiserrors: 51420 = target list not in workspace, 51421 = template not in
// workspace, 51422 (update) = re-pointed target list not in workspace.
// Unique-index violations on UQ_Forms_PublicSlug: SQL error numbers 2601/2627.
function mapFormSqlError(c: Context, err: unknown): Response | null {
  const n = (err as any)?.number as number | undefined;
  if (n === 51420 || n === 51421 || n === 51422)
    return c.json({ error: { code: 'FORM_VALIDATION', message: (err as Error).message } }, 422) as unknown as Response;
  if (n === 2601 || n === 2627)
    return c.json({ error: { code: 'FORM_SLUG_TAKEN', message: 'Public slug already in use' } }, 409) as unknown as Response;
  return null;
}
