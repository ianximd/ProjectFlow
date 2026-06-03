CREATE OR ALTER PROCEDURE dbo.usp_List_List
    @SpaceId    UNIQUEIDENTIFIER,
    @FolderId   UNIQUEIDENTIFIER = NULL,
    @AllInSpace BIT = 1   -- 1 = every list in the space; 0 = only those directly under @FolderId (NULL => space root)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Lists
    WHERE SpaceId = @SpaceId AND DeletedAt IS NULL
      AND (@AllInSpace = 1
           OR (@FolderId IS NULL AND FolderId IS NULL)
           OR (FolderId = @FolderId))
    ORDER BY FolderId, Position;
END;
