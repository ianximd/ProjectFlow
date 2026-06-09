import { GraphQLError } from 'graphql';
import { builder } from './builder.js';
import { docsService } from '../modules/docs/docs.service.js';
import { requireObjectLevel, notFound } from './authz.js';
import type { GQLContext } from './context.js';
import type { Doc, DocPage, DocPageVersionMeta, DocTaskLink, DocScopeType } from '@projectflow/types';
import { ProjectRepository } from '../modules/projects/project.repository.js';
import { FolderRepository } from '../modules/hierarchy/folder.repository.js';
import { ListRepository } from '../modules/hierarchy/list.repository.js';

// Repos used only for the authoritative workspace derivation in createDoc.
const projectRepoForWs = new ProjectRepository();
const folderRepoForWs  = new FolderRepository();
const listRepoForWs    = new ListRepository();

/**
 * Derive the authoritative workspaceId from the doc's scope node.
 * Mirrors resolveScopeWorkspace() in docs.routes.ts so that the stored
 * WorkspaceId is always the scope's real workspace, not a caller-supplied value.
 * Returns null when the scope cannot be resolved (scope not found).
 */
async function resolveScopeWorkspace(
  scopeType: string,
  scopeId: string,
): Promise<string | null> {
  try {
    switch (scopeType) {
      case 'SPACE':
        // A Space IS a Project in ProjectFlow.
        return await projectRepoForWs.getWorkspaceId(scopeId);
      case 'LIST':
        return await listRepoForWs.getWorkspaceId(scopeId);
      case 'FOLDER':
        return await folderRepoForWs.getWorkspaceId(scopeId);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function requireUser(ctx: GQLContext): string {
  if (!ctx.user) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.user.userId;
}

/** Gate a doc op on its scope node (the ACL system knows SPACE/FOLDER/LIST). */
async function requireDocLevel(ctx: GQLContext, docId: string, min: 'VIEW' | 'EDIT'): Promise<Doc> {
  const doc = await docsService.getDoc(docId);
  if (!doc) notFound('Doc not found');
  await requireObjectLevel(ctx, doc.scopeType as any, doc.scopeId, min);
  return doc;
}

async function requirePageLevel(ctx: GQLContext, pageId: string, min: 'VIEW' | 'EDIT'): Promise<DocPage> {
  const node = await docsService.resolveScopeNode(pageId);
  if (!node) notFound('Page not found');
  await requireObjectLevel(ctx, node.scopeType as any, node.scopeId, min);
  const page = await docsService.getPage(pageId);
  if (!page) notFound('Page not found');
  return page;
}

export function registerDocsGraphql(): void {
  const DocType = builder.objectRef<Doc>('Doc');
  DocType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    workspaceId:  t.exposeString('workspaceId'),
    scopeType:    t.exposeString('scopeType'),
    scopeId:      t.exposeString('scopeId'),
    name:         t.exposeString('name'),
    icon:         t.string({ nullable: true, resolve: (d) => d.icon }),
    isWiki:       t.exposeBoolean('isWiki'),
    verifiedById: t.string({ nullable: true, resolve: (d) => d.verifiedById }),
    createdById:  t.exposeString('createdById'),
  }) });

  const DocPageType = builder.objectRef<DocPage>('DocPage');
  DocPageType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    docId:        t.exposeString('docId'),
    parentPageId: t.string({ nullable: true, resolve: (p) => p.parentPageId }),
    title:        t.exposeString('title'),
    icon:         t.string({ nullable: true, resolve: (p) => p.icon }),
    position:     t.exposeFloat('position'),
    bodyJson:     t.string({ nullable: true, resolve: (p) => p.bodyJson }),
  }) });

  const DocVersionType = builder.objectRef<DocPageVersionMeta>('DocPageVersion');
  DocVersionType.implement({ fields: (t) => ({
    id:            t.exposeString('id'),
    pageId:        t.exposeString('pageId'),
    createdById:   t.exposeString('createdById'),
    createdByName: t.exposeString('createdByName'),
  }) });

  const DocLinkType = builder.objectRef<DocTaskLink>('DocTaskLink');
  DocLinkType.implement({ fields: (t) => ({
    id:           t.exposeString('id'),
    docPageId:    t.exposeString('docPageId'),
    taskId:       t.exposeString('taskId'),
    kind:         t.exposeString('kind'),
    taskTitle:    t.exposeString('taskTitle'),
    taskIssueKey: t.exposeString('taskIssueKey'),
  }) });

  builder.queryFields((t) => ({
    docsByScope: t.field({
      type: [DocType],
      args: { scopeType: t.arg.string({ required: true }), scopeId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        requireUser(ctx);
        await requireObjectLevel(ctx, a.scopeType as any, a.scopeId, 'VIEW');
        return docsService.listDocsByScope(a.scopeType as DocScopeType, a.scopeId);
      },
    }),
    doc: t.field({
      type: DocType,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => requireDocLevel(ctx, a.id, 'VIEW'),
    }),
    docPages: t.field({
      type: [DocPageType],
      args: { docId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requireDocLevel(ctx, a.docId, 'VIEW');
        return docsService.listPages(a.docId);
      },
    }),
    docPageVersions: t.field({
      type: [DocVersionType],
      args: { pageId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requirePageLevel(ctx, a.pageId, 'VIEW');
        return docsService.listVersions(a.pageId);
      },
    }),
    docPageLinks: t.field({
      type: [DocLinkType],
      args: { pageId: t.arg.string({ required: true }) },
      resolve: async (_, a, ctx) => {
        await requirePageLevel(ctx, a.pageId, 'VIEW');
        return docsService.listLinks(a.pageId);
      },
    }),
  }));

  builder.mutationFields((t) => ({
    createDoc: t.field({
      type: DocType,
      args: {
        workspaceId: t.arg.string({ required: true }),
        scopeType:   t.arg.string({ required: true }),
        scopeId:     t.arg.string({ required: true }),
        name:        t.arg.string({ required: true }),
        icon:        t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        // Object-level ACL gate: caller must hold EDIT on the scope node.
        await requireObjectLevel(ctx, a.scopeType as any, a.scopeId, 'EDIT');

        // Security hardening: derive the authoritative workspaceId from the
        // scope node rather than trusting the caller-supplied workspaceId.
        // Mirrors resolveScopeWorkspace() in docs.routes.ts.
        const resolvedWorkspaceId = await resolveScopeWorkspace(a.scopeType, a.scopeId);
        if (!resolvedWorkspaceId) {
          notFound('Scope not found');
        }
        if (a.workspaceId.toLowerCase() !== resolvedWorkspaceId.toLowerCase()) {
          throw new GraphQLError('workspaceId does not match scope', { extensions: { code: 'BAD_REQUEST' } });
        }

        const { doc } = await docsService.createDoc(
          resolvedWorkspaceId, a.scopeType as DocScopeType, a.scopeId, a.name, a.icon ?? null, userId,
        );
        return doc;
      },
    }),
    createDocPage: t.field({
      type: DocPageType,
      args: {
        docId:        t.arg.string({ required: true }),
        parentPageId: t.arg.string({ required: false }),
        title:        t.arg.string({ required: false }),
        afterPageId:  t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requireDocLevel(ctx, a.docId, 'EDIT');
        return docsService.createPage(a.docId, a.parentPageId ?? null, a.title ?? undefined, undefined, a.afterPageId ?? null);
      },
    }),
    moveDocPage: t.field({
      type: DocPageType,
      nullable: true,
      args: {
        pageId:       t.arg.string({ required: true }),
        parentPageId: t.arg.string({ required: false }),
        afterPageId:  t.arg.string({ required: false }),
      },
      resolve: async (_, a, ctx) => {
        await requirePageLevel(ctx, a.pageId, 'EDIT');
        return docsService.movePage(a.pageId, a.parentPageId ?? null, a.afterPageId ?? null);
      },
    }),
    restoreDocPageVersion: t.field({
      type: DocPageType,
      nullable: true,
      args: {
        pageId:    t.arg.string({ required: true }),
        versionId: t.arg.string({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        await requirePageLevel(ctx, a.pageId, 'EDIT');
        return docsService.restoreVersion(a.pageId, a.versionId, userId);
      },
    }),
    setDocWiki: t.field({
      type: DocType,
      nullable: true,
      args: {
        docId:  t.arg.string({ required: true }),
        isWiki: t.arg.boolean({ required: true }),
      },
      resolve: async (_, a, ctx) => {
        const userId = requireUser(ctx);
        await requireDocLevel(ctx, a.docId, 'EDIT');
        return docsService.setWiki(a.docId, a.isWiki, userId);
      },
    }),
  }));
}
