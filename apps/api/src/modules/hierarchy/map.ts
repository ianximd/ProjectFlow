export interface FolderShape { id: string; workspaceId: string; spaceId: string; parentFolderId: string | null; name: string; position: number; path: string; workflowId: string | null; createdAt: string; updatedAt: string; }
export interface ListShape { id: string; workspaceId: string; spaceId: string; folderId: string | null; name: string; position: number; path: string; workflowId: string | null; isDefault: boolean; createdAt: string; updatedAt: string; }

export function mapFolderRow(r: any): FolderShape {
  return { id: r.Id, workspaceId: r.WorkspaceId, spaceId: r.SpaceId, parentFolderId: r.ParentFolderId ?? null, name: r.Name, position: r.Position, path: r.Path, workflowId: r.WorkflowId ?? null, createdAt: r.CreatedAt, updatedAt: r.UpdatedAt };
}
export function mapListRow(r: any): ListShape {
  return { id: r.Id, workspaceId: r.WorkspaceId, spaceId: r.SpaceId, folderId: r.FolderId ?? null, name: r.Name, position: r.Position, path: r.Path, workflowId: r.WorkflowId ?? null, isDefault: Boolean(r.IsDefault), createdAt: r.CreatedAt, updatedAt: r.UpdatedAt };
}
