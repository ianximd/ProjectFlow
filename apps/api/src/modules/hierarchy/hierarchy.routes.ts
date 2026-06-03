import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HierarchyRepository } from './hierarchy.repository.js';
import { requireObjectAccess } from '../access/access.middleware.js';

const repo = new HierarchyRepository();
export const hierarchyRoutes = new Hono();
const q = z.object({ nodeType: z.enum(['SPACE', 'FOLDER', 'LIST']), nodeId: z.string().uuid() });

hierarchyRoutes.get('/everything', zValidator('query', q),
  requireObjectAccess('VIEW', (c) => ({ type: c.req.query('nodeType') as any, id: c.req.query('nodeId')! })),
  async (c) => c.json({ data: await repo.descendantTasks(c.req.query('nodeType') as any, c.req.query('nodeId')!) }),
);
