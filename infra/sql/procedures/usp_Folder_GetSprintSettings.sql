CREATE OR ALTER PROCEDURE dbo.usp_Folder_GetSprintSettings
    @FolderId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.*, f.IsSprintFolder
    FROM   dbo.Folders f
    LEFT JOIN dbo.SprintSettings s ON s.FolderId = f.Id
    WHERE  f.Id = @FolderId AND f.DeletedAt IS NULL;
END;
GO
