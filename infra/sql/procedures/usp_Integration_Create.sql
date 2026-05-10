CREATE OR ALTER PROCEDURE dbo.usp_Integration_Create
    @WorkspaceId UNIQUEIDENTIFIER,
    @Provider    NVARCHAR(20),
    @ChannelName NVARCHAR(255),
    @WebhookUrl  NVARCHAR(2000),
    @Events      NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Id     UNIQUEIDENTIFIER = NEWID();
    DECLARE @Evts   NVARCHAR(MAX)    = ISNULL(@Events,
        '["task.created","task.transitioned","sprint.started","sprint.completed"]');

    INSERT INTO dbo.IntegrationConnections
        (Id, WorkspaceId, Provider, ChannelName, WebhookUrl, Events, IsActive, CreatedAt)
    VALUES
        (@Id, @WorkspaceId, @Provider, @ChannelName, @WebhookUrl, @Evts, 1, SYSUTCDATETIME());

    SELECT Id, WorkspaceId, Provider, ChannelName, WebhookUrl, Events, IsActive, CreatedAt
    FROM   dbo.IntegrationConnections
    WHERE  Id = @Id;
END;
