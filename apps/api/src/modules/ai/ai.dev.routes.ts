/**
 * DEV / TEST ONLY — AI reindex endpoint.
 *
 * POST /api/v1/dev/ai/reindex   { workspaceId }
 *
 * Synchronously reindexes all tasks, docs, and comments in the given workspace
 * by calling runIndexJob() for each. No Redis / BullMQ needed — designed for
 * integration tests that need a corpus without the queue.
 *
 * Strictly guarded to non-production:
 *   - Returns 404 when NODE_ENV === 'production'.
 *   - Requires a valid Bearer token (authMiddleware applied at the /dev mount).
 *
 * Mirrors automation.dev.routes.ts and scheduled-report.dev.routes.ts.
 */

import { Hono } from 'hono';
import sql from 'mssql';
import { getPool } from '../../shared/lib/db.js';
import { runIndexJob } from './index/ai-index.worker.js';
import type { Variables } from '../../server.js';

export const aiDevRoutes = new Hono<{ Variables: Variables }>();

aiDevRoutes.post('/ai/reindex', async (c) => {
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}) as any);
  const workspaceId = body?.workspaceId as string | undefined;
  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400);
  }

  const pool = await getPool();

  // Enumerate tasks for this workspace.
  const taskRes = await pool.request()
    .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
    .query(`SELECT Id FROM dbo.Tasks WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL`);
  const taskIds: string[] = taskRes.recordset.map((r: any) => r.Id as string);

  // Enumerate docs for this workspace.
  const docRes = await pool.request()
    .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
    .query(`SELECT Id FROM dbo.Docs WHERE WorkspaceId = @WorkspaceId AND DeletedAt IS NULL`);
  const docIds: string[] = docRes.recordset.map((r: any) => r.Id as string);

  // Enumerate comments: resolve via their parent task's WorkspaceId.
  const commentRes = await pool.request()
    .input('WorkspaceId', sql.UniqueIdentifier, workspaceId)
    .query(`
      SELECT c.Id
      FROM dbo.Comments c
      JOIN dbo.Tasks t ON t.Id = c.TaskId
      WHERE t.WorkspaceId = @WorkspaceId
        AND c.DeletedAt IS NULL
        AND t.DeletedAt IS NULL
    `);
  const commentIds: string[] = commentRes.recordset.map((r: any) => r.Id as string);

  // Synchronously index all objects (no Redis).
  for (const objectId of taskIds) {
    await runIndexJob({ workspaceId, objectType: 'task', objectId, op: 'upsert' });
  }
  for (const objectId of docIds) {
    await runIndexJob({ workspaceId, objectType: 'doc', objectId, op: 'upsert' });
  }
  for (const objectId of commentIds) {
    await runIndexJob({ workspaceId, objectType: 'comment', objectId, op: 'upsert' });
  }

  return c.json({
    data: {
      tasks:    taskIds.length,
      docs:     docIds.length,
      comments: commentIds.length,
    },
  }, 200);
});
