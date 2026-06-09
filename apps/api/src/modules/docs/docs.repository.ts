import sql from 'mssql';
import { execSp, execSpOne } from '../../shared/lib/sqlClient.js';
import type {
  Doc, DocPage, DocPageVersionMeta, DocTaskLink, DocScopeType, DocTaskLinkKind,
} from '@projectflow/types';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function toDoc(r: any): Doc {
  return {
    id: r.Id, workspaceId: r.WorkspaceId, scopeType: r.ScopeType as DocScopeType, scopeId: r.ScopeId,
    name: r.Name, icon: r.Icon ?? null, isWiki: Boolean(r.IsWiki), verifiedById: r.VerifiedById ?? null,
    createdById: r.CreatedById, createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt),
  };
}

function toPage(r: any): DocPage {
  return {
    id: r.Id, docId: r.DocId, parentPageId: r.ParentPageId ?? null, title: r.Title,
    icon: r.Icon ?? null, cover: r.Cover ?? null, position: Number(r.Position),
    bodyJson: r.BodyJson ?? null, createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt),
  };
}

function toVersionMeta(r: any): DocPageVersionMeta {
  return {
    id: r.Id, pageId: r.PageId, createdById: r.CreatedById,
    createdByName: r.CreatedByName, createdAt: iso(r.CreatedAt),
  };
}

function toLink(r: any): DocTaskLink {
  return {
    id: r.Id, docPageId: r.DocPageId, taskId: r.TaskId, kind: r.Kind as DocTaskLinkKind,
    taskTitle: r.TaskTitle, taskIssueKey: r.TaskIssueKey, createdAt: iso(r.CreatedAt),
  };
}

export class DocsRepository {
  async createDoc(
    workspaceId: string, scopeType: DocScopeType, scopeId: string,
    name: string, icon: string | null, createdById: string,
  ): Promise<{ doc: Doc; rootPage: DocPage }> {
    const sets = await execSp<any>('usp_Doc_Create', [
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
      { name: 'ScopeType',   type: sql.NVarChar(8),      value: scopeType },
      { name: 'ScopeId',     type: sql.UniqueIdentifier, value: scopeId },
      { name: 'Name',        type: sql.NVarChar(255),    value: name },
      { name: 'Icon',        type: sql.NVarChar(64),     value: icon },
      { name: 'CreatedById', type: sql.UniqueIdentifier, value: createdById },
    ]);
    return { doc: toDoc(sets[0][0]), rootPage: toPage(sets[1][0]) };
  }

  async getDoc(docId: string): Promise<Doc | null> {
    const rows = await execSpOne<any>('usp_Doc_GetById', [
      { name: 'DocId', type: sql.UniqueIdentifier, value: docId },
    ]);
    return rows[0] ? toDoc(rows[0]) : null;
  }

  async listDocsByScope(scopeType: DocScopeType, scopeId: string): Promise<Doc[]> {
    const rows = await execSpOne<any>('usp_Doc_ListByScope', [
      { name: 'ScopeType', type: sql.NVarChar(8),      value: scopeType },
      { name: 'ScopeId',   type: sql.UniqueIdentifier, value: scopeId },
    ]);
    return rows.map(toDoc);
  }

  async setWiki(docId: string, isWiki: boolean, verifiedById: string | null): Promise<Doc | null> {
    const rows = await execSpOne<any>('usp_Doc_SetWiki', [
      { name: 'DocId',        type: sql.UniqueIdentifier, value: docId },
      { name: 'IsWiki',       type: sql.Bit,              value: isWiki },
      { name: 'VerifiedById', type: sql.UniqueIdentifier, value: verifiedById },
    ]);
    return rows[0] ? toDoc(rows[0]) : null;
  }

  /** ACL anchor: page → owning doc's scope node + workspace. */
  async resolveScopeNode(
    docPageId: string,
  ): Promise<{ scopeType: DocScopeType; scopeId: string; workspaceId: string; docId: string } | null> {
    const rows = await execSpOne<any>('usp_Doc_ResolveScopeNode', [
      { name: 'DocPageId', type: sql.UniqueIdentifier, value: docPageId },
    ]);
    const r = rows[0];
    return r ? { scopeType: r.ScopeType, scopeId: r.ScopeId, workspaceId: r.WorkspaceId, docId: r.DocId } : null;
  }

  async createPage(
    docId: string, parentPageId: string | null, title: string,
    icon: string | null, position: number,
  ): Promise<DocPage> {
    const rows = await execSpOne<any>('usp_DocPage_Create', [
      { name: 'DocId',        type: sql.UniqueIdentifier, value: docId },
      { name: 'ParentPageId', type: sql.UniqueIdentifier, value: parentPageId },
      { name: 'Title',        type: sql.NVarChar(255),    value: title },
      { name: 'Icon',         type: sql.NVarChar(64),     value: icon },
      { name: 'Position',     type: sql.Float,            value: position },
    ]);
    return toPage(rows[0]);
  }

  async getPage(pageId: string): Promise<DocPage | null> {
    const rows = await execSpOne<any>('usp_DocPage_GetById', [
      { name: 'PageId', type: sql.UniqueIdentifier, value: pageId },
    ]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async listPages(docId: string): Promise<DocPage[]> {
    const rows = await execSpOne<any>('usp_DocPage_ListByDoc', [
      { name: 'DocId', type: sql.UniqueIdentifier, value: docId },
    ]);
    return rows.map(toPage);
  }

  async updatePage(pageId: string, patch: { title?: string; icon?: string; cover?: string }): Promise<DocPage | null> {
    const rows = await execSpOne<any>('usp_DocPage_Update', [
      { name: 'PageId', type: sql.UniqueIdentifier, value: pageId },
      { name: 'Title',  type: sql.NVarChar(255),    value: patch.title ?? null },
      { name: 'Icon',   type: sql.NVarChar(64),     value: patch.icon ?? null },
      { name: 'Cover',  type: sql.NVarChar(1024),   value: patch.cover ?? null },
    ]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async movePage(pageId: string, parentPageId: string | null, position: number): Promise<DocPage | null> {
    const rows = await execSpOne<any>('usp_DocPage_Move', [
      { name: 'PageId',       type: sql.UniqueIdentifier, value: pageId },
      { name: 'ParentPageId', type: sql.UniqueIdentifier, value: parentPageId },
      { name: 'Position',     type: sql.Float,            value: position },
    ]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async deletePage(pageId: string): Promise<void> {
    await execSpOne('usp_DocPage_Delete', [
      { name: 'PageId', type: sql.UniqueIdentifier, value: pageId },
    ]);
  }

  async createVersion(pageId: string, snapshot: string, createdById: string): Promise<DocPageVersionMeta> {
    const rows = await execSpOne<any>('usp_DocPageVersion_Create', [
      { name: 'PageId',      type: sql.UniqueIdentifier,  value: pageId },
      { name: 'Snapshot',    type: sql.NVarChar(sql.MAX), value: snapshot },
      { name: 'CreatedById', type: sql.UniqueIdentifier,  value: createdById },
    ]);
    return toVersionMeta(rows[0]);
  }

  async listVersions(pageId: string): Promise<DocPageVersionMeta[]> {
    const rows = await execSpOne<any>('usp_DocPageVersion_List', [
      { name: 'PageId', type: sql.UniqueIdentifier, value: pageId },
    ]);
    return rows.map(toVersionMeta);
  }

  async restoreVersion(pageId: string, versionId: string, createdById: string): Promise<DocPage | null> {
    const rows = await execSpOne<any>('usp_DocPage_Restore', [
      { name: 'PageId',      type: sql.UniqueIdentifier, value: pageId },
      { name: 'VersionId',   type: sql.UniqueIdentifier, value: versionId },
      { name: 'CreatedById', type: sql.UniqueIdentifier, value: createdById },
    ]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  async createLink(docPageId: string, taskId: string, kind: DocTaskLinkKind): Promise<DocTaskLink> {
    const rows = await execSpOne<any>('usp_DocTaskLink_Create', [
      { name: 'DocPageId', type: sql.UniqueIdentifier, value: docPageId },
      { name: 'TaskId',    type: sql.UniqueIdentifier, value: taskId },
      { name: 'Kind',      type: sql.NVarChar(20),     value: kind },
    ]);
    return toLink(rows[0]);
  }

  async listLinks(docPageId: string): Promise<DocTaskLink[]> {
    const rows = await execSpOne<any>('usp_DocTaskLink_ListByPage', [
      { name: 'DocPageId', type: sql.UniqueIdentifier, value: docPageId },
    ]);
    return rows.map(toLink);
  }

  async deleteLink(linkId: string): Promise<void> {
    await execSpOne('usp_DocTaskLink_Delete', [
      { name: 'LinkId', type: sql.UniqueIdentifier, value: linkId },
    ]);
  }
}
