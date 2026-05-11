CREATE OR ALTER PROCEDURE dbo.usp_Comment_GetContext
    @CommentId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
        t.WorkspaceId,
        c.AuthorId AS OwnerId
    FROM dbo.Comments c
    JOIN dbo.Tasks    t ON t.Id = c.TaskId
    WHERE c.Id = @CommentId
      AND t.DeletedAt IS NULL
      AND c.DeletedAt IS NULL;
END;
