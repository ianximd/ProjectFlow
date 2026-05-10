CREATE OR ALTER PROCEDURE dbo.usp_GitCommit_ListByTask
  @TaskId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT Id, TaskId, Provider, RepoOwner, RepoName, CommitSha, Message, Url,
         Author, AuthorAvatarUrl, CommittedAt, CreatedAt
  FROM dbo.GitCommits
  WHERE TaskId = @TaskId
  ORDER BY CommittedAt DESC;
END;
GO
