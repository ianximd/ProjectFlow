CREATE OR ALTER PROCEDURE dbo.usp_Webhook_ListDeliveries
    @WebhookId UNIQUEIDENTIFIER,
    @Limit     INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Limit)
           Id, WebhookId, Event, StatusCode, DurationMs, Attempt, Success, DeliveredAt
    FROM   dbo.WebhookDeliveries
    WHERE  WebhookId = @WebhookId
    ORDER  BY DeliveredAt DESC;
END;
