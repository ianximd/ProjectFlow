-- Returns active webhooks for a workspace that subscribe to the given event
CREATE OR ALTER PROCEDURE dbo.usp_Webhook_GetActive
    @WorkspaceId UNIQUEIDENTIFIER,
    @Event       NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    -- Use JSON_VALUE / OPENJSON to filter by event subscription
    SELECT w.Id, w.WorkspaceId, w.Url, w.Secret, w.Events
    FROM   dbo.Webhooks w
    WHERE  w.WorkspaceId = @WorkspaceId
      AND  w.IsActive = 1
      AND  EXISTS (
             SELECT 1
             FROM   OPENJSON(w.Events)
             WHERE  [value] = @Event
           );
END;
