import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { DocScopeType } from '@projectflow/types';

/**
 * Data access for the Yjs collaboration server. All three SPs are deployed
 * in infra/sql/procedures:
 *   - usp_Doc_ResolveScopeNode(@DocPageId) -> ScopeType, ScopeId, WorkspaceId, DocId
 *   - usp_DocPage_LoadYjs(@PageId)         -> BodyYjs (VARBINARY), BodyJson
 *   - usp_DocPage_PersistYjs(@PageId, @BodyYjs, @BodyJson)
 */
export class CollabRepository {
  async resolveScopeNode(
    docPageId: string,
  ): Promise<{ scopeType: DocScopeType; scopeId: string; workspaceId: string } | null> {
    const rows = await execSpOne<{ ScopeType: DocScopeType; ScopeId: string; WorkspaceId: string }>(
      'usp_Doc_ResolveScopeNode',
      [{ name: 'DocPageId', type: sql.UniqueIdentifier, value: docPageId }],
    );
    const r = rows[0];
    return r ? { scopeType: r.ScopeType, scopeId: r.ScopeId, workspaceId: r.WorkspaceId } : null;
  }

  async loadYjs(pageId: string): Promise<Buffer | null> {
    const rows = await execSpOne<{ BodyYjs: Buffer | null }>('usp_DocPage_LoadYjs', [
      { name: 'PageId', type: sql.UniqueIdentifier, value: pageId },
    ]);
    return rows[0]?.BodyYjs ?? null;
  }

  async persistYjs(pageId: string, bodyYjs: Buffer, bodyJson: string): Promise<void> {
    await execSpOne('usp_DocPage_PersistYjs', [
      { name: 'PageId',   type: sql.UniqueIdentifier,   value: pageId },
      { name: 'BodyYjs',  type: sql.VarBinary(sql.MAX), value: bodyYjs },
      { name: 'BodyJson', type: sql.NVarChar(sql.MAX),  value: bodyJson },
    ]);
  }
}
