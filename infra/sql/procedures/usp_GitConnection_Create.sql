CREATE OR ALTER PROCEDURE dbo.usp_GitConnection_Create
  @WorkspaceId   UNIQUEIDENTIFIER,
  @Provider      NVARCHAR(20),
  @RepoOwner     NVARCHAR(255),
  @RepoName      NVARCHAR(255),
  @WebhookSecret NVARCHAR(500),
  @WebhookId     NVARCHAR(100) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.GitConnections (WorkspaceId, Provider, RepoOwner, RepoName, WebhookSecret, WebhookId)
  VALUES (@WorkspaceId, @Provider, @RepoOwner, @RepoName, @WebhookSecret, @WebhookId);
  SELECT Id, WorkspaceId, Provider, RepoOwner, RepoName, WebhookId, CreatedAt
  FROM dbo.GitConnections
  WHERE WorkspaceId = @WorkspaceId AND Provider = @Provider
    AND RepoOwner = @RepoOwner AND RepoName = @RepoName;
END;
GO
