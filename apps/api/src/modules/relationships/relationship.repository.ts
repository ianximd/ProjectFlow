import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { RelationshipRef } from '@projectflow/types';

// SPs return PascalCase columns; the RelationshipRef contract is camelCase.
// Map at the repository boundary so callers (REST, GraphQL, service) get the
// declared shape.
function toRelRef(row: any): RelationshipRef {
  return {
    taskId:   row.TaskId,
    title:    row.Title,
    status:   row.Status,
    issueKey: row.IssueKey ?? null,
  };
}

export class RelationshipRepository {
  /** EXEC usp_TaskRelationship_Add — returns the inserted/existing link row. */
  async add(fieldId: string, fromTaskId: string, toTaskId: string, workspaceId: string): Promise<any> {
    const rows = await execSpOne<any>('usp_TaskRelationship_Add', [
      { name: 'FieldId',     type: sql.UniqueIdentifier, value: fieldId },
      { name: 'FromTaskId',  type: sql.UniqueIdentifier, value: fromTaskId },
      { name: 'ToTaskId',    type: sql.UniqueIdentifier, value: toTaskId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rows[0] ?? null;
  }

  /**
   * usp_TaskRelationship_Remove — returns the number of links removed.
   * Workspace-scoped (defense-in-depth): only removes rows in @WorkspaceId.
   */
  async remove(fieldId: string, fromTaskId: string, toTaskId: string, workspaceId: string): Promise<number> {
    const rows = await execSpOne<{ Removed: number }>('usp_TaskRelationship_Remove', [
      { name: 'FieldId',     type: sql.UniqueIdentifier, value: fieldId },
      { name: 'FromTaskId',  type: sql.UniqueIdentifier, value: fromTaskId },
      { name: 'ToTaskId',    type: sql.UniqueIdentifier, value: toTaskId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return rows[0]?.Removed ?? 0;
  }

  /**
   * usp_TaskRelationship_ListForField — the ToTask refs linked from @FromTaskId.
   * Workspace-scoped (defense-in-depth): only rows in @WorkspaceId.
   */
  async listForField(fieldId: string, fromTaskId: string, workspaceId: string): Promise<RelationshipRef[]> {
    const rows = await execSpOne<any>('usp_TaskRelationship_ListForField', [
      { name: 'FieldId',     type: sql.UniqueIdentifier, value: fieldId },
      { name: 'FromTaskId',  type: sql.UniqueIdentifier, value: fromTaskId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return (rows as any[]).map(toRelRef);
  }

  /**
   * Plain ToTaskId list for a relationship field on a task (rollup source
   * resolution). Workspace-scoped. The SP caps at TOP (500) and we also
   * `.slice(0, 500)` here: >500 linked tasks per field is unsupported for
   * rollup v1 (bounds the per-rollup fan-out read).
   */
  async relatedTaskIds(relationshipFieldId: string, fromTaskId: string, workspaceId: string): Promise<string[]> {
    const rows = await execSpOne<{ TaskId: string }>('usp_TaskRelationship_ListForField', [
      { name: 'FieldId',     type: sql.UniqueIdentifier, value: relationshipFieldId },
      { name: 'FromTaskId',  type: sql.UniqueIdentifier, value: fromTaskId },
      { name: 'WorkspaceId', type: sql.UniqueIdentifier, value: workspaceId },
    ]);
    return (rows as any[]).map((r) => r.TaskId).slice(0, 500);
  }
}
