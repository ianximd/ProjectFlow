-- Phase 8e: hard-delete a target (leaf row). Idempotent.
CREATE OR ALTER PROCEDURE dbo.usp_Target_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        DELETE FROM dbo.Targets WHERE Id = @Id;
        SELECT @@ROWCOUNT AS Deleted;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
