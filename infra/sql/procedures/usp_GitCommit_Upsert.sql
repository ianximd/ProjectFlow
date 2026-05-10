CREATE OR ALTER PROCEDURE dbo.usp_GitCommit_Upsert
  @TaskId          UNIQUEIDENTIFIER,
  @Provider        NVARCHAR(20),
  @RepoOwner       NVARCHAR(255),
  @RepoName        NVARCHAR(255),
  @CommitSha       NVARCHAR(40),
  @Message         NVARCHAR(2000),
  @Url             NVARCHAR(1000),
  @Author          NVARCHAR(255),
  @AuthorAvatarUrl NVARCHAR(1000) = NULL,
  @CommittedAt     DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (
    SELECT 1 FROM dbo.GitCommits
    WHERE TaskId = @TaskId AND Provider = @Provider
      AND RepoOwner = @RepoOwner AND RepoName = @RepoName AND CommitSha = @CommitSha
  )
  BEGIN
    INSERT INTO dbo.GitCommits
      (TaskId, Provider, RepoOwner, RepoName, CommitSha, Message, Url,
       Author, AuthorAvatarUrl, CommittedAt)
    VALUES
      (@TaskId, @Provider, @RepoOwner, @RepoName, @CommitSha, @Message, @Url,
       @Author, @AuthorAvatarUrl, @CommittedAt);
  END;
  SELECT * FROM dbo.GitCommits
  WHERE TaskId = @TaskId AND Provider = @Provider
    AND RepoOwner = @RepoOwner AND RepoName = @RepoName AND CommitSha = @CommitSha;
END;
GO
