CREATE OR ALTER PROCEDURE dbo.usp_Webhook_GetWorkspaceId
    @WebhookId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 WorkspaceId
    FROM dbo.Webhooks
    WHERE Id = @WebhookId;
END;
