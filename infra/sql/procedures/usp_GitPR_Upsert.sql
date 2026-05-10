CREATE OR ALTER PROCEDURE dbo.usp_GitPR_Upsert
  @TaskId          UNIQUEIDENTIFIER,
  @Provider        NVARCHAR(20),
  @RepoOwner       NVARCHAR(255),
  @RepoName        NVARCHAR(255),
  @PrNumber        INT,
  @Title           NVARCHAR(500),
  @Url             NVARCHAR(1000),
  @Author          NVARCHAR(255),
  @AuthorAvatarUrl NVARCHAR(1000) = NULL,
  @State           NVARCHAR(20),
  @HeadBranch      NVARCHAR(500),
  @BaseBranch      NVARCHAR(500),
  @MergedAt        DATETIME2 = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM dbo.GitPullRequests
    WHERE TaskId = @TaskId AND Provider = @Provider
      AND RepoOwner = @RepoOwner AND RepoName = @RepoName AND PrNumber = @PrNumber
  )
  BEGIN
    UPDATE dbo.GitPullRequests
    SET Title = @Title, Url = @Url, Author = @Author, AuthorAvatarUrl = @AuthorAvatarUrl,
        State = @State, HeadBranch = @HeadBranch, BaseBranch = @BaseBranch,
        MergedAt = @MergedAt, UpdatedAt = SYSUTCDATETIME()
    WHERE TaskId = @TaskId AND Provider = @Provider
      AND RepoOwner = @RepoOwner AND RepoName = @RepoName AND PrNumber = @PrNumber;
  END
  ELSE
  BEGIN
    INSERT INTO dbo.GitPullRequests
      (TaskId, Provider, RepoOwner, RepoName, PrNumber, Title, Url,
       Author, AuthorAvatarUrl, State, HeadBranch, BaseBranch, MergedAt)
    VALUES
      (@TaskId, @Provider, @RepoOwner, @RepoName, @PrNumber, @Title, @Url,
       @Author, @AuthorAvatarUrl, @State, @HeadBranch, @BaseBranch, @MergedAt);
  END;
  SELECT * FROM dbo.GitPullRequests
  WHERE TaskId = @TaskId AND Provider = @Provider
    AND RepoOwner = @RepoOwner AND RepoName = @RepoName AND PrNumber = @PrNumber;
END;
GO
