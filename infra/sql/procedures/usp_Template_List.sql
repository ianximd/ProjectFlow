-- Phase 5d: list a workspace's live templates, optionally narrowed by scope.
-- Snapshot is NOT projected here (it can be large) — the Template Center only
-- needs metadata; the apply preview reads the single row via GetById.
CREATE OR ALTER PROCEDURE dbo.usp_Template_List
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT Id, WorkspaceId, ScopeType, Name, Description, CreatedById, CreatedAt, UpdatedAt, DeletedAt
        FROM   dbo.Templates
        WHERE  WorkspaceId = @WorkspaceId
          AND  DeletedAt IS NULL
          AND  (@ScopeType IS NULL OR ScopeType = @ScopeType)
        ORDER  BY CreatedAt DESC;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
