CREATE OR ALTER PROCEDURE dbo.usp_GitPR_ListByTask
  @TaskId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT Id, TaskId, Provider, RepoOwner, RepoName, PrNumber, Title, Url,
         Author, AuthorAvatarUrl, State, HeadBranch, BaseBranch, MergedAt, CreatedAt, UpdatedAt
  FROM dbo.GitPullRequests
  WHERE TaskId = @TaskId
  ORDER BY CreatedAt DESC;
END;
GO
