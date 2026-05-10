CREATE OR ALTER PROCEDURE dbo.usp_Integration_List
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, WorkspaceId, Provider, ChannelName, WebhookUrl, Events, IsActive, CreatedAt
    FROM   dbo.IntegrationConnections
    WHERE  WorkspaceId = @WorkspaceId
    ORDER BY CreatedAt;
END;
