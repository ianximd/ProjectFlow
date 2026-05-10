CREATE OR ALTER PROCEDURE dbo.usp_Webhook_List
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, WorkspaceId, Name, Url, Events, IsActive, CreatedAt
    FROM   dbo.Webhooks
    WHERE  WorkspaceId = @WorkspaceId
    ORDER  BY CreatedAt;
END;
