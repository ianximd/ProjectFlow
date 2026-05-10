-- Returns the full row including WebhookSecret (used server-side for webhook verification only)
CREATE OR ALTER PROCEDURE dbo.usp_GitConnection_GetByRepo
  @Provider  NVARCHAR(20),
  @RepoOwner NVARCHAR(255),
  @RepoName  NVARCHAR(255)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP 1 Id, WorkspaceId, Provider, RepoOwner, RepoName, WebhookSecret, WebhookId, CreatedAt
  FROM dbo.GitConnections
  WHERE Provider = @Provider AND RepoOwner = @RepoOwner AND RepoName = @RepoName;
END;
GO
