import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { customFieldService } from './customfield.service.js';
import { CustomFieldRepository } from './customfield.repository.js';
import { FieldValidationError } from './customfield.errors.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import { pubsub } from '../../graphql/pubsub.js';

export const customFieldRoutes = new Hono();
const repo = new CustomFieldRepository();

const SCOPE = z.enum(['SPACE', 'FOLDER', 'LIST']);
const TYPE = z.enum([
  'text','text_area','number','currency','checkbox','date','url','email','phone',
  'dropdown','labels','rating','people','progress_manual','progress_auto',
  'relationship','rollup',
]);
const fieldRefSchema = z.object({ kind: z.enum(['builtin', 'custom']), key: z.string() });
const configSchema = z.object({
  options: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() })).optional(),
  currencyCode: z.string().optional(),
  max: z.number().int().optional(),
  precision: z.number().int().optional(),
  includeTime: z.boolean().optional(),
  source: z.literal('subtasks').optional(),
  // relationship (Phase 5b)
  relationshipTargetType: z.enum(['any', 'list']).optional(),
  relationshipTargetListId: z.string().optional(),
  // rollup (Phase 5b) — shape-checked here; required-presence enforced by validateFieldConfig.
  rollupRelationshipFieldId: z.string().optional(),
  rollupSourceField: fieldRefSchema.optional(),
  rollupFunction: z.enum(['sum', 'avg', 'count', 'min', 'max', 'first', 'concat']).optional(),
}).nullable();

const createSchema = z.object({
  scopeType: SCOPE, scopeId: z.string().uuid(), type: TYPE,
  name: z.string().min(1).max(255), config: configSchema.optional(),
  required: z.boolean().default(false), position: z.number().default(0),
});
const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: configSchema.optional(), clearConfig: z.boolean().optional(),
  required: z.boolean().optional(),
});

// POST /custom-fields — EDIT on the scope node
customFieldRoutes.post('/', zValidator('json', createSchema),
  requireObjectAccess('EDIT', (c) => {
    const b = (c.req as any).valid('json');
    return { type: b.scopeType, id: b.scopeId };
  }),
  async (c) => {
    const b = c.req.valid('json');
    let field;
    try {
      field = await customFieldService.create({
        scopeType: b.scopeType, scopeId: b.scopeId, type: b.type, name: b.name,
        config: b.config ?? null, required: b.required, position: b.position,
      });
    } catch (err) {
      if (err instanceof FieldValidationError) return c.json({ error: { code: err.fieldCode, message: err.message } }, 422);
      throw err;
    }
    if (!field) return c.json({ error: { code: 'NOT_FOUND', message: 'Scope not found' } }, 404);
    pubsub.publish('customField:updated', { scopeId: b.scopeId, field });
    return c.json({ data: field }, 201);
  });

// GET /custom-fields?scopeType&scopeId — VIEW on the scope node
const listQuery = z.object({ scopeType: SCOPE, scopeId: z.string().uuid() });
customFieldRoutes.get('/', zValidator('query', listQuery),
  requireObjectAccess('VIEW', (c) => ({ type: c.req.query('scopeType') as any, id: c.req.query('scopeId')! })),
  async (c) => c.json({ data: await customFieldService.list(c.req.query('scopeType') as any, c.req.query('scopeId')!) }));

// PATCH /custom-fields/:id — EDIT (resolve scope via the field's own scope)
customFieldRoutes.patch('/:id', zValidator('json', updateSchema),
  requireObjectAccess('EDIT', async (c) => {
    const f = await repo.getById(c.req.param('id')!);
    return f ? { type: f.scopeType, id: f.scopeId } : null;
  }),
  async (c) => {
    let field;
    try {
      field = await customFieldService.update(c.req.param('id')!, c.req.valid('json'));
    } catch (err) {
      if (err instanceof FieldValidationError) return c.json({ error: { code: err.fieldCode, message: err.message } }, 422);
      throw err;
    }
    if (!field) return c.json({ error: { code: 'NOT_FOUND', message: 'Custom field not found' } }, 404);
    pubsub.publish('customField:updated', { scopeId: field.scopeId, field });
    return c.json({ data: field });
  });

// DELETE /custom-fields/:id — FULL
customFieldRoutes.delete('/:id',
  requireObjectAccess('FULL', async (c) => {
    const f = await repo.getById(c.req.param('id')!);
    return f ? { type: f.scopeType, id: f.scopeId } : null;
  }),
  async (c) => {
    const field = await customFieldService.delete(c.req.param('id')!);
    if (!field) return c.json({ error: { code: 'NOT_FOUND', message: 'Custom field not found' } }, 404);
    pubsub.publish('customField:updated', { scopeId: field.scopeId, field });
    return c.json({ data: field });
  });

// PATCH /custom-fields/:id/reorder — EDIT
const reorderSchema = z.object({ position: z.number() });
customFieldRoutes.patch('/:id/reorder', zValidator('json', reorderSchema),
  requireObjectAccess('EDIT', async (c) => {
    const f = await repo.getById(c.req.param('id')!);
    return f ? { type: f.scopeType, id: f.scopeId } : null;
  }),
  async (c) => {
    const field = await customFieldService.reorder(c.req.param('id')!, c.req.valid('json').position);
    if (!field) return c.json({ error: { code: 'NOT_FOUND', message: 'Custom field not found' } }, 404);
    pubsub.publish('customField:updated', { scopeId: field.scopeId, field });
    return c.json({ data: field });
  });
