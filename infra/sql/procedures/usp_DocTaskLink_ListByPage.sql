CREATE OR ALTER PROCEDURE dbo.usp_DocTaskLink_ListByPage
    @DocPageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.Id, l.DocPageId, l.TaskId, l.Kind, l.CreatedAt,
           t.Title AS TaskTitle, t.IssueKey AS TaskIssueKey
    FROM dbo.DocTaskLinks l
    JOIN dbo.Tasks t ON t.Id = l.TaskId
    WHERE l.DocPageId = @DocPageId
    ORDER BY l.CreatedAt DESC;
END;
GO
