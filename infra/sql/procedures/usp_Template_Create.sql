-- Phase 5d: create a template from a captured snapshot. The caller has already
-- resolved the source node's WorkspaceId and built the Snapshot JSON (capture
-- composes existing reads). Returns the new row (SELECT *).
CREATE OR ALTER PROCEDURE dbo.usp_Template_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(8),
    @Name        NVARCHAR(255),
    @Description NVARCHAR(MAX) = NULL,
    @Snapshot    NVARCHAR(MAX),
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT INTO dbo.Templates (
            Id, WorkspaceId, ScopeType, Name, Description, Snapshot, CreatedById
        ) VALUES (
            @Id, @WorkspaceId, @ScopeType, @Name, @Description, @Snapshot, @CreatedById
        );

        SELECT * FROM dbo.Templates WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
