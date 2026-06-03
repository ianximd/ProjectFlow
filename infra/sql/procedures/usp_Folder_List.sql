CREATE OR ALTER PROCEDURE dbo.usp_Folder_List
    @SpaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Folders
    WHERE SpaceId = @SpaceId AND DeletedAt IS NULL
    ORDER BY ParentFolderId, Position;
END;
