CREATE OR ALTER PROCEDURE dbo.usp_Folder_Move
    @Id                UNIQUEIDENTIFIER,
    @NewParentFolderId UNIQUEIDENTIFIER = NULL,
    @NewPosition       FLOAT,
    @NewPath           NVARCHAR(900)   -- computed by the service from the new parent's path
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @OldPath NVARCHAR(900);
        SELECT @OldPath = Path FROM dbo.Folders WHERE Id = @Id AND DeletedAt IS NULL;
        IF @OldPath IS NULL THROW 51202, 'Folder not found', 1;

        IF @NewParentFolderId IS NOT NULL AND EXISTS (
            SELECT 1 FROM dbo.Folders WHERE Id = @NewParentFolderId AND Path LIKE @OldPath + '%')
            THROW 51203, 'Cannot move a folder into its own descendant', 1;

        UPDATE dbo.Folders
        SET ParentFolderId = @NewParentFolderId, Position = @NewPosition, Path = @NewPath, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id;

        UPDATE dbo.Folders
        SET Path = @NewPath + SUBSTRING(Path, LEN(@OldPath) + 1, 900), UpdatedAt = SYSUTCDATETIME()
        WHERE Path LIKE @OldPath + '%' AND Id <> @Id;

        UPDATE dbo.Lists
        SET Path = @NewPath + SUBSTRING(Path, LEN(@OldPath) + 1, 900), UpdatedAt = SYSUTCDATETIME()
        WHERE Path LIKE @OldPath + '%';

        UPDATE dbo.Tasks
        SET ListPath = @NewPath + SUBSTRING(ListPath, LEN(@OldPath) + 1, 900)
        WHERE ListPath LIKE @OldPath + '%';

        COMMIT TRANSACTION;
        SELECT * FROM dbo.Folders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
