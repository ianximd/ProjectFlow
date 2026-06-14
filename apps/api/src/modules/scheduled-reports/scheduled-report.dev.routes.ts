/**
 * DEV / TEST ONLY — scheduled-report sweep endpoint.
 *
 * POST /api/v1/dev/scheduled-reports/sweep   { scheduleId? }
 *
 * Forces the given schedule's NextRunAt into the past (so usp_ScheduledReport_ListDue
 * picks it up immediately), then runs ONE immediate sweep and returns the counts.
 * Strictly guarded to non-production:
 *   - Returns 404 when NODE_ENV === 'production'.
 *   - Requires a valid Bearer token (authMiddleware applied at the /dev mount).
 *
 * Intended use: Playwright e2e that needs to exercise the snapshot → record →
 * inbox-deliver → advance pipeline without waiting for the 5-minute BullMQ tick.
 * Mirrors automation.dev.routes.ts.
 */

import { Hono } from 'hono';
import sql from 'mssql';
import { getPool } from '../../shared/lib/db.js';
import { runScheduledReportSweep } from './scheduled-report.worker.js';
import type { Variables } from '../../server.js';

export const scheduledReportDevRoutes = new Hono<{ Variables: Variables }>();

scheduledReportDevRoutes.post('/scheduled-reports/sweep', async (c) => {
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }
  const body = await c.req.json().catch(() => ({}) as any);
  const scheduleId = body?.scheduleId as string | undefined;
  if (scheduleId) {
    const pool = await getPool();
    await pool.request()
      .input('Id', sql.UniqueIdentifier, scheduleId)
      .query("UPDATE dbo.ScheduledReports SET NextRunAt = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE Id = @Id");
  }
  const counts = await runScheduledReportSweep();
  return c.json(counts, 200);
});
