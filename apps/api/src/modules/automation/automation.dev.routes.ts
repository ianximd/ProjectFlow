/**
 * DEV / TEST ONLY — automation scheduler sweep endpoint.
 *
 * POST /api/v1/dev/automation/sweep
 *
 * Triggers one immediate scheduler sweep and returns the enqueue counts.
 * This endpoint is strictly guarded to non-production environments:
 *   - Returns 404 when NODE_ENV === 'production'.
 *   - Requires a valid Bearer token (authMiddleware applied at mount).
 *
 * Intended use: Playwright e2e tests that need to exercise the full
 * DUE_DATE_PASSED / DATE_ARRIVED / SCHEDULED pipeline without waiting for
 * the 5-minute BullMQ JobScheduler tick.
 */

import { Hono } from 'hono';
import { runScheduledSweep } from './automation.scheduler.worker.js';
import type { Variables } from '../../server.js';

export const automationDevRoutes = new Hono<{ Variables: Variables }>();

automationDevRoutes.post('/automation/sweep', async (c) => {
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }
  const counts = await runScheduledSweep();
  return c.json(counts, 200);
});
