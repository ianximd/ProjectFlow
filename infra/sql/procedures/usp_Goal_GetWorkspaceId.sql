-- Phase 8e: resolve a goal's WorkspaceId for RBAC resolveWorkspace (0 rows when missing).
CREATE OR ALTER PROCEDURE dbo.usp_Goal_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT WorkspaceId FROM dbo.Goals WHERE Id = @Id AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
