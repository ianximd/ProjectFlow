-- Look up a task by its issue key (e.g. 'PF-123') — used by webhook processor
CREATE OR ALTER PROCEDURE dbo.usp_Task_GetByIssueKey
  @IssueKey NVARCHAR(30)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP 1 Id, ProjectId, WorkspaceId, IssueKey, Title, Status
  FROM dbo.Tasks
  WHERE IssueKey = @IssueKey AND DeletedAt IS NULL;
END;
GO
