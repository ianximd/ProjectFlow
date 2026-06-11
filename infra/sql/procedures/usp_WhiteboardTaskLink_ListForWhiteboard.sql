CREATE OR ALTER PROCEDURE dbo.usp_WhiteboardTaskLink_ListForWhiteboard
    @WhiteboardId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        l.Id, l.WhiteboardId, l.TaskId, l.ShapeId, l.CreatedAt,
        t.Title  AS TaskTitle,
        t.Status AS TaskStatus,
        t.IssueKey AS TaskIssueKey
    FROM dbo.WhiteboardTaskLinks l
    JOIN dbo.Tasks t ON t.Id = l.TaskId
    WHERE l.WhiteboardId = @WhiteboardId AND t.DeletedAt IS NULL
    ORDER BY l.CreatedAt DESC;
END;
GO
