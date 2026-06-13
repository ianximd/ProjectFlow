-- Phase 8e: one non-deleted goal by id (0 rows when missing/deleted).
CREATE OR ALTER PROCEDURE dbo.usp_Goal_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.Goals WHERE Id = @Id AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
