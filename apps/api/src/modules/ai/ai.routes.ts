/**
 * AI routes — Phase 11a, Task 10.
 *
 * POST /ai/search
 *   Gate: ai.use permission (workspace-scoped).
 *   Body: { workspaceId, query, scope?, k? }
 *   Returns: { data: RetrievedChunk[] }
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { retrievalService } from './retrieval/retrieval.service.js';

export const aiRoutes = new Hono();

const searchSchema = z.object({
  workspaceId: z.string().uuid(),
  query:       z.string().min(1),
  /**
   * Optional scope restriction. The API accepts {type,id} and maps to the
   * service's {scopeType,scopeId} so the route layer owns the translation and
   * callers don't need to know the internal field names.
   */
  scope: z
    .object({ type: z.string(), id: z.string() })
    .optional(),
  k: z.number().int().positive().max(20).optional(),
});

aiRoutes.post(
  '/search',
  zValidator('json', searchSchema),
  requirePermission('ai.use', {
    // Mirror the resolveWorkspaceFromBody pattern in scheduled-report.routes.ts:
    // re-parse the JSON body (Hono caches the parsed body so there is no second
    // stream read in practice) to pull workspaceId for the permission check.
    resolveWorkspace: async (c) => {
      try { const body = await c.req.json(); return body?.workspaceId ?? null; } catch { return null; }
    },
  }),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const { workspaceId, query, scope, k } = c.req.valid('json');

    const chunks = await retrievalService.retrieve(userId, workspaceId, query, {
      scope: scope ? { scopeType: scope.type as any, scopeId: scope.id } : undefined,
      k,
    });

    return c.json({ data: chunks });
  },
);
