import { Hono } from 'hono';
import { searchService } from './search.service.js';

export const searchRoutes = new Hono();

/**
 * GET /api/v1/search
 *
 * Query params:
 *   workspaceId (required)
 *   pql         — PQL string (takes precedence)
 *   q           — free-text search
 *   projectId, type, status, priority, assigneeId, reporterId,
 *   sprintId, openSprints, dueAfter, dueBefore, createdAfter, updatedAfter,
 *   orderBy, orderDir, page, pageSize
 */
searchRoutes.get('/', async (c) => {
  const user        = (c as any).get('user') as any;
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json({ error: { message: 'workspaceId is required' } }, 400);
  }

  const page     = Math.max(1, parseInt(c.req.query('page')     ?? '1',  10));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') ?? '25', 10)));

  const pqlString = c.req.query('pql');

  try {
    let result;

    if (pqlString) {
      result = await searchService.searchPQL(pqlString, workspaceId, user.userId, page, pageSize);
    } else {
      result = await searchService.search({
        workspaceId,
        projectId:    c.req.query('projectId')    ?? null,
        q:            c.req.query('q')            ?? null,
        type:         c.req.query('type')         ?? null,
        status:       c.req.query('status')       ?? null,
        priority:     c.req.query('priority')     ?? null,
        assigneeId:   c.req.query('assigneeId')   ?? null,
        reporterId:   c.req.query('reporterId')   ?? null,
        sprintId:     c.req.query('sprintId')     ?? null,
        openSprints:  c.req.query('openSprints')  === 'true',
        dueAfter:     c.req.query('dueAfter')     ?? null,
        dueBefore:    c.req.query('dueBefore')    ?? null,
        createdAfter: c.req.query('createdAfter') ?? null,
        updatedAfter: c.req.query('updatedAfter') ?? null,
        orderBy:      c.req.query('orderBy')      ?? 'CreatedAt',
        orderDir:     (c.req.query('orderDir') as 'ASC' | 'DESC') ?? 'DESC',
        page,
        pageSize,
      });
    }

    return c.json({
      data: result.tasks,
      meta: { total: result.total, page, pageSize },
    });
  } catch (err: any) {
    return c.json({ error: { message: 'Search failed' } }, 500);
  }
});
