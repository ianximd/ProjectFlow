CREATE OR ALTER PROCEDURE dbo.usp_View_Reorder
    @Id       UNIQUEIDENTIFIER,
    @Position FLOAT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.SavedViews WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51500, 'Saved view not found', 1;
        UPDATE dbo.SavedViews SET Position = @Position, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.SavedViews WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
