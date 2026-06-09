import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { docsService } from './docs.service.js';
import { DocsRepository } from './docs.repository.js';
import { ListRepository } from '../hierarchy/list.repository.js';
import { FolderRepository } from '../hierarchy/folder.repository.js';
import { ProjectRepository } from '../projects/project.repository.js';
import { requirePermission } from '../../shared/middleware/permissions.middleware.js';
import { requireObjectAccess } from '../access/access.middleware.js';
import type { DocScopeType, HierarchyNodeType } from '@projectflow/types';

export const docRoutes = new Hono();

// Repos used only by RBAC resolvers (cheap single-SP calls).
const docRepoForLookup    = new DocsRepository();
const listRepoForLookup   = new ListRepository();
const folderRepoForLookup = new FolderRepository();
const projectRepoForLookup = new ProjectRepository();

// ── RBAC workspace resolvers ──────────────────────────────────────────────────

/** Resolve workspace from a doc id (RBAC anchor for /:docId routes). */
const resolveDocWorkspace = async (c: any): Promise<string | null> => {
  const doc = await docRepoForLookup.getDoc(c.req.param('docId'));
  return doc?.workspaceId ?? null;
};

/** Resolve workspace from a page id (RBAC anchor for /pages/:id routes). */
const resolvePageWorkspace = async (c: any): Promise<string | null> => {
  const node = await docRepoForLookup.resolveScopeNode(c.req.param('id'));
  return node?.workspaceId ?? null;
};

/**
 * Derive the workspace that owns a given doc scope node.
 * This is the authoritative source for RBAC anchoring and stored WorkspaceId.
 * Returns null when the scope cannot be resolved (fail-closed).
 */
async function resolveScopeWorkspace(
  scopeType: string | undefined,
  scopeId:   string | undefined,
): Promise<string | null> {
  if (!scopeType || !scopeId) return null;
  try {
    switch (scopeType) {
      case 'SPACE':
        // A Space IS a Project in ProjectFlow.
        return await projectRepoForLookup.getWorkspaceId(scopeId);
      case 'LIST':
        return await listRepoForLookup.getWorkspaceId(scopeId);
      case 'FOLDER':
        return await folderRepoForLookup.getWorkspaceId(scopeId);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Resolve workspace for POST /docs — derive from scopeType + scopeId in the
 * request body so that RBAC is anchored to the scope's actual workspace, not
 * a caller-supplied workspaceId.
 */
async function resolveDocWorkspaceFromBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    return resolveScopeWorkspace(body?.scopeType, body?.scopeId);
  } catch {
    return null;
  }
}

/**
 * Resolve workspace for POST /docs/pages — body carries docId; look up the doc.
 */
async function resolveDocWorkspaceFromPageBody(c: any): Promise<string | null> {
  try {
    const body = await c.req.json();
    if (!body?.docId) return null;
    const doc = await docRepoForLookup.getDoc(body.docId);
    return doc?.workspaceId ?? null;
  } catch {
    return null;
  }
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createDocSchema = z.object({
  workspaceId: z.string().uuid(),
  scopeType:   z.enum(['SPACE', 'FOLDER', 'LIST']),
  scopeId:     z.string().uuid(),
  name:        z.string().min(1).max(255),
  icon:        z.string().max(64).optional(),
});

const createPageSchema = z.object({
  docId:        z.string().uuid(),
  parentPageId: z.string().uuid().nullish(),
  title:        z.string().max(255).optional(),
  icon:         z.string().max(64).optional(),
  afterPageId:  z.string().uuid().nullish(),
});

const updatePageSchema = z.object({
  title: z.string().max(255).optional(),
  icon:  z.string().max(64).optional(),
  cover: z.string().max(1024).optional(),
});

const movePageSchema = z.object({
  parentPageId: z.string().uuid().nullable(),
  afterPageId:  z.string().uuid().nullable(),
});

const versionSchema    = z.object({ snapshot: z.string().min(2) });
const createTaskSchema = z.object({
  listId: z.string().uuid(),
  title:  z.string().min(1).max(500),
  kind:   z.enum(['reference', 'embed']).optional(),
});
const linkSchema       = z.object({
  taskId: z.string().uuid(),
  kind:   z.enum(['reference', 'embed']).optional(),
});
const wikiSchema       = z.object({ isWiki: z.boolean() });

// ── Doc CRUD ──────────────────────────────────────────────────────────────────

docRoutes.post(
  '/',
  requirePermission('doc.create', { resolveWorkspace: resolveDocWorkspaceFromBody }),
  zValidator('json', createDocSchema),
  async (c) => {
    const user = (c as any).get('user');
    const b = c.req.valid('json');

    // Re-derive the workspace from the scope — never trust the caller-supplied
    // workspaceId for the stored value (defense-in-depth against cross-tenant write).
    const resolvedWorkspaceId = await resolveScopeWorkspace(b.scopeType, b.scopeId);
    if (!resolvedWorkspaceId) {
      return c.json({ error: { message: 'Scope not found' } }, 404);
    }
    if (b.workspaceId !== resolvedWorkspaceId) {
      return c.json({ error: { message: 'workspaceId does not match scope' } }, 400);
    }

    const { doc, rootPage } = await docsService.createDoc(
      resolvedWorkspaceId, b.scopeType as DocScopeType, b.scopeId, b.name, b.icon ?? null, user.userId,
    );
    return c.json({ data: { ...doc, rootPage } }, 201);
  },
);

docRoutes.get(
  '/',
  // HOLE 2 FIX: gate on VIEW access to the scope node, mirroring docsByScope GraphQL resolver.
  // If scopeType/scopeId are missing the resolver returns null → 404 (fail-closed).
  requireObjectAccess('VIEW', (c) => {
    const scopeType = c.req.query('scopeType');
    const scopeId   = c.req.query('scopeId');
    if (!scopeType || !scopeId) return null;
    return { type: scopeType as HierarchyNodeType, id: scopeId };
  }),
  async (c) => {
    const scopeType = c.req.query('scopeType');
    const scopeId   = c.req.query('scopeId');
    if (!scopeType || !scopeId) {
      return c.json({ error: { message: 'scopeType and scopeId are required' } }, 400);
    }
    const docs = await docsService.listDocsByScope(scopeType as DocScopeType, scopeId);
    return c.json({ data: docs });
  },
);

// ── Page operations — STATIC /pages segments BEFORE dynamic /:docId ───────────

docRoutes.post(
  '/pages',
  requirePermission('doc.update', { resolveWorkspace: resolveDocWorkspaceFromPageBody }),
  zValidator('json', createPageSchema),
  async (c) => {
    const b = c.req.valid('json');
    const page = await docsService.createPage(
      b.docId, b.parentPageId ?? null, b.title, b.icon, b.afterPageId ?? null,
    );
    return c.json({ data: page }, 201);
  },
);

docRoutes.get(
  '/pages/:id',
  requirePermission('doc.read', { resolveWorkspace: resolvePageWorkspace }),
  async (c) => {
    const page = await docsService.getPage(c.req.param('id')!);
    if (!page) return c.json({ error: { message: 'Page not found' } }, 404);
    return c.json({ data: page });
  },
);

docRoutes.patch(
  '/pages/:id',
  requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }),
  zValidator('json', updatePageSchema),
  async (c) => {
    const page = await docsService.updatePage(c.req.param('id')!, c.req.valid('json'));
    if (!page) return c.json({ error: { message: 'Page not found' } }, 404);
    return c.json({ data: page });
  },
);

docRoutes.post(
  '/pages/:id/move',
  requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }),
  zValidator('json', movePageSchema),
  async (c) => {
    const b = c.req.valid('json');
    try {
      const page = await docsService.movePage(c.req.param('id')!, b.parentPageId, b.afterPageId);
      if (!page) return c.json({ error: { message: 'Page not found' } }, 404);
      return c.json({ data: page });
    } catch (err: any) {
      if (err?.number === 51700 || String(err?.message).includes('51700')) {
        return c.json({ error: { code: 'CYCLE', message: 'Cannot move a page under its own descendant' } }, 409);
      }
      throw err;
    }
  },
);

docRoutes.delete(
  '/pages/:id',
  requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }),
  async (c) => {
    await docsService.deletePage(c.req.param('id')!);
    return c.body(null, 204);
  },
);

// ── Version history ───────────────────────────────────────────────────────────

docRoutes.get(
  '/pages/:id/versions',
  requirePermission('doc.read', { resolveWorkspace: resolvePageWorkspace }),
  async (c) => {
    return c.json({ data: await docsService.listVersions(c.req.param('id')!) });
  },
);

docRoutes.post(
  '/pages/:id/versions',
  requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }),
  zValidator('json', versionSchema),
  async (c) => {
    const user = (c as any).get('user');
    const v = await docsService.createVersion(
      c.req.param('id')!, c.req.valid('json').snapshot, user.userId,
    );
    return c.json({ data: v }, 201);
  },
);

docRoutes.post(
  '/pages/:id/versions/:vid/restore',
  requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }),
  async (c) => {
    const user = (c as any).get('user');
    try {
      const page = await docsService.restoreVersion(
        c.req.param('id')!, c.req.param('vid')!, user.userId,
      );
      if (!page) return c.json({ error: { message: 'Version or page not found' } }, 404);
      return c.json({ data: page });
    } catch (err: any) {
      if (err?.number === 51701 || String(err?.message).includes('51701')) {
        return c.json({ error: { message: 'Version not found for this page' } }, 404);
      }
      throw err;
    }
  },
);

// ── Doc↔Task links + create-task-from-selection ───────────────────────────────

docRoutes.get(
  '/pages/:id/links',
  requirePermission('doc.read', { resolveWorkspace: resolvePageWorkspace }),
  async (c) => {
    return c.json({ data: await docsService.listLinks(c.req.param('id')!) });
  },
);

docRoutes.post(
  '/pages/:id/links',
  requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }),
  zValidator('json', linkSchema),
  async (c) => {
    const b = c.req.valid('json');
    const link = await docsService.createLink(c.req.param('id')!, b.taskId, b.kind ?? 'reference');
    return c.json({ data: link }, 201);
  },
);

docRoutes.post(
  '/pages/:id/create-task',
  requirePermission('doc.update', { resolveWorkspace: resolvePageWorkspace }),
  zValidator('json', createTaskSchema),
  // HOLE 1 FIX: authorize the TARGET LIST exactly like the task move route does.
  // zValidator has already run, so c.req.valid('json') is synchronously available.
  requireObjectAccess('EDIT', (c) => ({ type: 'LIST', id: (c.req as any).valid('json').listId })),
  async (c) => {
    const user = (c as any).get('user');
    const b = c.req.valid('json');

    // Verify the page exists (resolveScopeNode doubles as a 404 guard).
    const node = await docRepoForLookup.resolveScopeNode(c.req.param('id')!);
    if (!node) return c.json({ error: { message: 'Page not found' } }, 404);

    try {
      const link = await docsService.createTaskFromSelection(
        c.req.param('id')!, b.listId, b.title, user.userId, b.kind ?? 'reference',
      );
      return c.json({ data: link }, 201);
    } catch (err: any) {
      if (err?.statusCode === 404) return c.json({ error: { message: 'List not found' } }, 404);
      throw err;
    }
  },
);

// ── Wiki flag ─────────────────────────────────────────────────────────────────

docRoutes.put(
  '/:docId/wiki',
  requirePermission('doc.update', { resolveWorkspace: resolveDocWorkspace }),
  zValidator('json', wikiSchema),
  async (c) => {
    const user = (c as any).get('user');
    const doc = await docsService.setWiki(c.req.param('docId')!, c.req.valid('json').isWiki, user.userId);
    if (!doc) return c.json({ error: { message: 'Doc not found' } }, 404);
    return c.json({ data: doc });
  },
);

// ── Doc read + page tree — dynamic /:docId LAST ───────────────────────────────

docRoutes.get(
  '/:docId/pages',
  requirePermission('doc.read', { resolveWorkspace: resolveDocWorkspace }),
  async (c) => {
    return c.json({ data: await docsService.listPages(c.req.param('docId')!) });
  },
);

docRoutes.get(
  '/:docId',
  requirePermission('doc.read', { resolveWorkspace: resolveDocWorkspace }),
  async (c) => {
    const doc = await docsService.getDoc(c.req.param('docId')!);
    if (!doc) return c.json({ error: { message: 'Doc not found' } }, 404);
    return c.json({ data: doc });
  },
);
