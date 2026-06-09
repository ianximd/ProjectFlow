CREATE OR ALTER PROCEDURE dbo.usp_DocTaskLink_Create
    @DocPageId UNIQUEIDENTIFIER,
    @TaskId    UNIQUEIDENTIFIER,
    @Kind      NVARCHAR(20) = 'reference'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.DocTaskLinks (Id, DocPageId, TaskId, Kind)
    VALUES (@Id, @DocPageId, @TaskId, @Kind);

    SELECT l.Id, l.DocPageId, l.TaskId, l.Kind, l.CreatedAt,
           t.Title AS TaskTitle, t.IssueKey AS TaskIssueKey
    FROM dbo.DocTaskLinks l
    JOIN dbo.Tasks t ON t.Id = l.TaskId
    WHERE l.Id = @Id;
END;
GO
