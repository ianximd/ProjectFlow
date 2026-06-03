CREATE OR ALTER PROCEDURE dbo.usp_List_Move
    @Id          UNIQUEIDENTIFIER,
    @NewFolderId UNIQUEIDENTIFIER = NULL,
    @NewPosition FLOAT,
    @NewPath     NVARCHAR(900)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @OldPath NVARCHAR(900);
        SELECT @OldPath = Path FROM dbo.Lists WHERE Id = @Id AND DeletedAt IS NULL;
        IF @OldPath IS NULL THROW 51210, 'List not found', 1;

        UPDATE dbo.Lists
        SET FolderId = @NewFolderId, Position = @NewPosition, Path = @NewPath, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id;

        UPDATE dbo.Tasks SET ListPath = @NewPath WHERE ListId = @Id;

        COMMIT TRANSACTION;
        SELECT * FROM dbo.Lists WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
