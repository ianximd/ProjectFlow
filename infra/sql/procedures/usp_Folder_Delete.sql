CREATE OR ALTER PROCEDURE dbo.usp_Folder_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Folders WHERE Id = @Id AND DeletedAt IS NULL)
            THROW 51202, 'Folder not found', 1;
        IF EXISTS (SELECT 1 FROM dbo.Lists   WHERE FolderId = @Id AND DeletedAt IS NULL)
            THROW 51204, 'Folder is not empty (has lists)', 1;
        IF EXISTS (SELECT 1 FROM dbo.Folders WHERE ParentFolderId = @Id AND DeletedAt IS NULL)
            THROW 51204, 'Folder is not empty (has subfolders)', 1;
        UPDATE dbo.Folders SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;
        SELECT * FROM dbo.Folders WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
