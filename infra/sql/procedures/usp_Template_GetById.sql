-- Phase 5d: read one live template by id, INCLUDING the Snapshot (the apply
-- preview / apply path needs the full subtree JSON).
CREATE OR ALTER PROCEDURE dbo.usp_Template_GetById
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT * FROM dbo.Templates WHERE Id = @Id AND DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
