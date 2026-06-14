import { Hono }       from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z }          from 'zod';
import { scheduledReportService, InvalidCadenceError, ScheduleAccessError, RecipientNotMemberError } from './scheduled-report.service.js';
import { scheduledReportRepository } from './scheduled-report.repository.js';
import { requirePermission }         from '../../shared/middleware/permissions.middleware.js';

export const scheduledReportRoutes = new Hono();

// Map service errors to HTTP. A cross-tenant/forbidden binding → 403; a malformed
// cadence or non-member recipient → 400. Anything else rethrows (→ 500 via the
// global handler) so unexpected failures aren't masked.
function mapScheduleError(c: any, e: unknown): Response {
  if (e instanceof ScheduleAccessError)     return c.json({ error: { message: e.message, code: e.code } }, 403);
  if (e instanceof RecipientNotMemberError) return c.json({ error: { message: e.message, code: e.code } }, 400);
  if (e instanceof InvalidCadenceError)     return c.json({ error: { message: e.message, code: e.code } }, 400);
  throw e;
}

const cadenceSchema = z.object({
  freq:       z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval:   z.number().int().positive(),
  byWeekday:  z.array(z.number().int().min(0).max(6)).optional(),
  byMonthday: z.number().int().min(1).max(31).optional(),
  endsAt:     z.string().datetime().optional(),
  count:      z.number().int().positive().optional(),
});

const createSchema = z.object({
  workspaceId:     z.string().uuid(),
  dashboardId:     z.string().uuid().nullable().optional(),
  reportKind:      z.string().max(24).nullable().optional(),
  reportParams:    z.record(z.string(), z.unknown()).nullable().optional(),
  cadence:         cadenceSchema,
  deliveryChannel: z.enum(['inbox', 'email']).optional(),
  recipients:      z.array(z.string().uuid()).min(1),
});

const updateSchema = z.object({
  cadence:         cadenceSchema.optional(),
  deliveryChannel: z.enum(['inbox', 'email']).optional(),
  recipients:      z.array(z.string().uuid()).min(1).optional(),
  enabled:         z.boolean().optional(),
});

// ── RBAC workspace resolvers ─────────────────────────────────────────────────
// POST gates on the body's workspaceId; the :id routes resolve the schedule's
// workspace (fail-closed → 404 when the schedule is missing).
const resolveWorkspaceFromBody = async (c: any): Promise<string | null> => {
  try { const body = await c.req.json(); return body?.workspaceId ?? null; } catch { return null; }
};
const resolveWorkspaceFromSchedule = async (c: any): Promise<string | null> => {
  const s = await scheduledReportRepository.getById(c.req.param('id')!);
  return s?.workspaceId ?? null;
};

// GET /scheduled-reports?workspaceId=
scheduledReportRoutes.get(
  '/',
  requirePermission('scheduled_report.manage', { resolveWorkspace: async (c: any) => c.req.query('workspaceId') ?? null }),
  async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
    const schedules = await scheduledReportService.listByWorkspace(workspaceId);
    return c.json({ data: schedules });
  },
);

// POST /scheduled-reports
scheduledReportRoutes.post(
  '/',
  zValidator('json', createSchema),
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromBody }),
  async (c) => {
    const userId = ((c as any).get('user') as any).userId as string;
    const input = c.req.valid('json');
    try {
      const schedule = await scheduledReportService.create(input as any, userId);
      return c.json({ data: schedule }, 201);
    } catch (e) { return mapScheduleError(c, e); }
  },
);

// PATCH /scheduled-reports/:id
scheduledReportRoutes.patch(
  '/:id',
  zValidator('json', updateSchema),
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromSchedule }),
  async (c) => {
    try {
      const updated = await scheduledReportService.update(c.req.param('id')!, c.req.valid('json') as any);
      if (!updated) return c.json({ error: { message: 'Schedule not found' } }, 404);
      return c.json({ data: updated });
    } catch (e) { return mapScheduleError(c, e); }
  },
);

// DELETE /scheduled-reports/:id
scheduledReportRoutes.delete(
  '/:id',
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromSchedule }),
  async (c) => {
    const n = await scheduledReportService.delete(c.req.param('id')!);
    if (n === 0) return c.json({ error: { message: 'Schedule not found' } }, 404);
    return c.body(null, 204);
  },
);

// GET /scheduled-reports/:id/runs?page=&pageSize=
scheduledReportRoutes.get(
  '/:id/runs',
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromSchedule }),
  async (c) => {
    const page     = parseInt(c.req.query('page')     ?? '1',  10);
    const pageSize = parseInt(c.req.query('pageSize') ?? '20', 10);
    const { runs, totalCount } = await scheduledReportService.listRuns(c.req.param('id')!, page, Math.min(pageSize, 50));
    return c.json({ data: runs, meta: { totalCount } });
  },
);

// GET /scheduled-reports/:id/runs/:runId/snapshot — read-only frozen payload
scheduledReportRoutes.get(
  '/:id/runs/:runId/snapshot',
  requirePermission('scheduled_report.manage', { resolveWorkspace: resolveWorkspaceFromSchedule }),
  async (c) => {
    const { runs } = await scheduledReportService.listRuns(c.req.param('id')!, 1, 50);
    const run = runs.find((r) => r.id.toUpperCase() === c.req.param('runId')!.toUpperCase());
    if (!run) return c.json({ error: { message: 'Run not found' } }, 404);
    return c.json({ data: { run, snapshot: run.snapshotRef ? JSON.parse(run.snapshotRef) : null } });
  },
);
