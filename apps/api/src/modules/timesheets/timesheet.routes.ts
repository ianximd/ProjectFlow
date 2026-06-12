import { Hono }       from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z }          from 'zod';
import { timesheetService } from './timesheet.service.js';
import { TimesheetRepository } from './timesheet.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';

const repoForLookup = new TimesheetRepository();
const resolveTimesheetWorkspace = async (c: any) =>
  (await repoForLookup.getById(c.req.param('id')!))?.workspaceId ?? null;

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note:     z.string().max(500).optional(),
});
const submitSchema = z.object({ note: z.string().max(500).optional() });

export const timesheetRoutes = new Hono();

// GET /timesheets?workspaceId=&periodStart=&periodEnd=
//   With period params → get-or-create that envelope. Without → list the user's.
timesheetRoutes.get(
  '/',
  requirePermission('timesheet.read', { resolveWorkspace: async (c) => c.req.query('workspaceId') ?? null }),
  async (c) => {
    const user        = (c as any).get('user') as any;
    const userId      = user.userId as string;
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) return c.json({ error: { message: 'workspaceId is required' } }, 400);
    const periodStart = c.req.query('periodStart');
    const periodEnd   = c.req.query('periodEnd');
    if (periodStart && periodEnd) {
      const ts = await timesheetService.getOrCreate(workspaceId, userId, periodStart, periodEnd);
      return c.json({ data: ts });
    }
    const list = await timesheetService.list(workspaceId, userId);
    return c.json({ data: list });
  },
);

// GET /timesheets/:id
timesheetRoutes.get(
  '/:id',
  requirePermission('timesheet.read', { resolveWorkspace: resolveTimesheetWorkspace }),
  async (c) => {
    const ts = await timesheetService.getById(c.req.param('id')!);
    if (!ts) return c.json({ error: { message: 'Not found' } }, 404);
    return c.json({ data: ts });
  },
);

// GET /timesheets/:id/aggregate
timesheetRoutes.get(
  '/:id/aggregate',
  requirePermission('timesheet.read', { resolveWorkspace: resolveTimesheetWorkspace }),
  async (c) => {
    const agg = await timesheetService.aggregate(c.req.param('id')!);
    return c.json({ data: agg });
  },
);

// POST /timesheets/:id/submit
timesheetRoutes.post(
  '/:id/submit',
  requirePermission('timesheet.submit', { resolveWorkspace: resolveTimesheetWorkspace }),
  zValidator('json', submitSchema),
  async (c) => {
    const user   = (c as any).get('user') as any;
    const userId = user.userId as string;
    const { note } = c.req.valid('json');
    try {
      const ts = await timesheetService.submit(c.req.param('id')!, userId, note ?? null);
      if (!ts) return c.json({ error: { message: 'Not found' } }, 404);
      return c.json({ data: ts });
    } catch (err: any) {
      if (err.number === 51810) return c.json({ error: { message: err.message } }, 409);
      if (err.number === 51812) return c.json({ error: { message: 'Not found' } }, 404);
      throw err;
    }
  },
);

// POST /timesheets/:id/review  — approve/reject
timesheetRoutes.post(
  '/:id/review',
  requirePermission('timesheet.approve', { resolveWorkspace: resolveTimesheetWorkspace }),
  zValidator('json', reviewSchema),
  async (c) => {
    const user   = (c as any).get('user') as any;
    const userId = user.userId as string;
    const { decision, note } = c.req.valid('json');
    try {
      const ts = await timesheetService.review(c.req.param('id')!, userId, decision, note ?? null);
      if (!ts) return c.json({ error: { message: 'Not found' } }, 404);
      return c.json({ data: ts });
    } catch (err: any) {
      if (err.number === 51811 || err.number === 51813) return c.json({ error: { message: err.message } }, 409);
      if (err.number === 51812) return c.json({ error: { message: 'Not found' } }, 404);
      throw err;
    }
  },
);
