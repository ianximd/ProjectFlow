CREATE OR ALTER PROCEDURE dbo.usp_List_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Lists WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51210, 'List not found', 1;
        IF EXISTS (SELECT 1 FROM dbo.Lists WHERE Id = @Id AND IsDefault = 1)
            THROW 51211, 'Cannot delete the default list', 1;
        IF EXISTS (SELECT 1 FROM dbo.Tasks WHERE ListId = @Id AND DeletedAt IS NULL)
            THROW 51212, 'List is not empty (has tasks)', 1;
        UPDATE dbo.Lists SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.Lists WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
