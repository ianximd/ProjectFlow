-- Phase 5d: soft-delete a template (stamp DeletedAt). Returns the affected row's
-- metadata (NOT the large Snapshot) ONLY when THIS call performed the delete; an
-- already-deleted/absent id yields no rows so the service maps it to a 404 (a
-- repeat delete is a 404, not a no-op 200).
CREATE OR ALTER PROCEDURE dbo.usp_Template_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DECLARE @n INT;

        UPDATE dbo.Templates
        SET    DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
        WHERE  Id = @Id AND DeletedAt IS NULL;

        SET @n = @@ROWCOUNT;
        IF @n = 0 RETURN;

        -- Metadata only (omit Snapshot, which can be large).
        SELECT Id, WorkspaceId, ScopeType, Name, Description,
               CreatedById, CreatedAt, UpdatedAt, DeletedAt
        FROM   dbo.Templates
        WHERE  Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
