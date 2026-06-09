import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { DocScopeType } from '@projectflow/types';

/**
 * Data access for the Yjs collaboration server. SPs are deployed
 * in infra/sql/procedures:
 *   - usp_Doc_ResolveScopeNode(@DocPageId) -> ScopeType, ScopeId, WorkspaceId, DocId
 *   - usp_DocPage_LoadYjs(@PageId)         -> BodyYjs (VARBINARY), BodyJson
 *   - usp_DocPage_PersistYjs(@PageId, @BodyYjs, @BodyJson)
 *   - usp_DocPageVersion_Create(@PageId, @Snapshot, @CreatedById)
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

  /**
   * Load both the binary Yjs state AND the rendered ProseMirror-JSON snapshot.
   *
   * BodyYjs is the source of truth once collaboration has begun. BodyJson is
   * the rendered snapshot — it is the fallback used to RE-SEED a fresh Yjs doc
   * after a version restore (usp_DocPage_Restore clears BodyYjs + sets BodyJson
   * to the restored snapshot, see onLoadDocument's JSON→Yjs reconstruction).
   */
  async loadYjs(pageId: string): Promise<{ bodyYjs: Buffer | null; bodyJson: string | null }> {
    const rows = await execSpOne<{ BodyYjs: Buffer | null; BodyJson: string | null }>(
      'usp_DocPage_LoadYjs',
      [{ name: 'PageId', type: sql.UniqueIdentifier, value: pageId }],
    );
    return { bodyYjs: rows[0]?.BodyYjs ?? null, bodyJson: rows[0]?.BodyJson ?? null };
  }

  async persistYjs(pageId: string, bodyYjs: Buffer, bodyJson: string): Promise<void> {
    await execSpOne('usp_DocPage_PersistYjs', [
      { name: 'PageId',   type: sql.UniqueIdentifier,   value: pageId },
      { name: 'BodyYjs',  type: sql.VarBinary(sql.MAX), value: bodyYjs },
      { name: 'BodyJson', type: sql.NVarChar(sql.MAX),  value: bodyJson },
    ]);
  }

  /**
   * Append a DocPageVersions checkpoint row (enhancement 1 — version-on-store).
   * Mirrors DocsRepository.createVersion; the snapshot is the rendered
   * ProseMirror-JSON body. The caller MUST supply a valid createdById (FK to
   * Users) — onStoreDocument guards this and skips the insert when unresolved.
   */
  async createVersion(pageId: string, snapshot: string, createdById: string): Promise<void> {
    await execSpOne('usp_DocPageVersion_Create', [
      { name: 'PageId',      type: sql.UniqueIdentifier,  value: pageId },
      { name: 'Snapshot',    type: sql.NVarChar(sql.MAX), value: snapshot },
      { name: 'CreatedById', type: sql.UniqueIdentifier,  value: createdById },
    ]);
  }
}
