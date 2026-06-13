-- Phase 8e: resolve a goal folder's WorkspaceId for RBAC resolveWorkspace
-- (0 rows when missing/deleted). Added by the Batch-4 security review (C2):
-- DELETE /goals/folders/:id MUST authorize the FOLDER's real workspace, never a
-- caller-supplied ?workspaceId param (usp_GoalFolder_Delete deletes by Id only).
CREATE OR ALTER PROCEDURE dbo.usp_GoalFolder_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT WorkspaceId FROM dbo.GoalFolders WHERE Id = @Id AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
