CREATE OR ALTER PROCEDURE dbo.usp_Webhook_LogDelivery
    @WebhookId    UNIQUEIDENTIFIER,
    @Event        NVARCHAR(50),
    @Payload      NVARCHAR(MAX),
    @StatusCode   INT          = NULL,
    @ResponseBody NVARCHAR(MAX) = NULL,
    @DurationMs   INT          = NULL,
    @Attempt      INT          = 1,
    @Success      BIT          = 0
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.WebhookDeliveries
        (Id, WebhookId, Event, Payload, StatusCode, ResponseBody, DurationMs, Attempt, Success, DeliveredAt)
    VALUES
        (NEWID(), @WebhookId, @Event, @Payload, @StatusCode, @ResponseBody, @DurationMs, @Attempt, @Success, SYSUTCDATETIME());
END;
