CREATE OR ALTER PROCEDURE dbo.usp_GitConnection_List
  @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT Id, WorkspaceId, Provider, RepoOwner, RepoName, WebhookId, CreatedAt
  FROM dbo.GitConnections
  WHERE WorkspaceId = @WorkspaceId
  ORDER BY CreatedAt ASC;
END;
GO
