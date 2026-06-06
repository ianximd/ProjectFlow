-- Phase 5d: soft-delete a template (stamp DeletedAt). Returns the affected row
-- (SELECT *), or no rows when the id was already gone — the service maps an empty
-- result to a 404.
CREATE OR ALTER PROCEDURE dbo.usp_Template_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.Templates
        SET    DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
        WHERE  Id = @Id AND DeletedAt IS NULL;

        SELECT * FROM dbo.Templates WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
