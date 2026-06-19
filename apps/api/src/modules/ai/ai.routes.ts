/**
 * AI routes.
 *
 * POST /ai/search (Phase 11a)
 *   Gate: ai.use permission (workspace-scoped).
 *   Body: { workspaceId, query, scope?, k? }
 *   Returns: { data: RetrievedChunk[] }
 *
 * POST /ai/ask (Phase 11b)
 *   Gate: ai.use permission (workspace-scoped).
 *   Body: { workspaceId, question, scope? }
 *   Returns: { data: { answer, citations } } — citations resolve only to objects
 *   the caller can VIEW (derived from the permission-filtered retrieved sources).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { retrievalService } from './retrieval/retrieval.service.js';
import { qaService } from './qa/qa.service.js';

export const aiRoutes = new Hono();

/** Shared: re-parse the JSON body for the permission middleware (Hono caches it). */
const resolveWorkspaceFromBody = async (c: any) => {
  try { const body = await c.req.json(); return body?.workspaceId ?? null; } catch { return null; }
};

const searchSchema = z.object({
  workspaceId: z.string().uuid(),
  query:       z.string().min(1),
  /**
   * Optional scope restriction. The API accepts {type,id} and maps to the
   * service's {scopeType,scopeId} so the route layer owns the translation and
   * callers don't need to know the internal field names.
   */
  scope: z
    .object({ type: z.enum(['SPACE', 'FOLDER', 'LIST']), id: z.string() })
    .optional(),
  k: z.number().int().positive().max(20).optional(),
});

aiRoutes.post(
  '/search',
  zValidator('json', searchSchema),
  requirePermission('ai.use', { resolveWorkspace: resolveWorkspaceFromBody }),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const { workspaceId, query, scope, k } = c.req.valid('json');

    const chunks = await retrievalService.retrieve(userId, workspaceId, query, {
      scope: scope ? { scopeType: scope.type, scopeId: scope.id } : undefined,
      k,
    });

    return c.json({ data: chunks });
  },
);

const askSchema = z.object({
  workspaceId: z.string().uuid(),
  question:    z.string().min(1),
  scope: z
    .object({ type: z.enum(['SPACE', 'FOLDER', 'LIST']), id: z.string() })
    .optional(),
});

aiRoutes.post(
  '/ask',
  zValidator('json', askSchema),
  requirePermission('ai.use', { resolveWorkspace: resolveWorkspaceFromBody }),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const { workspaceId, question, scope } = c.req.valid('json');

    const result = await qaService.ask(userId, workspaceId, question, scope);
    return c.json({ data: result });
  },
);
