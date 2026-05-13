-- Single-row read for the audit-snapshot fetcher (Phase 6 W43 Option A
-- extension). Returns the canonical outgoing-Webhook row by primary key.
--
-- Security: the Webhook row holds an HMAC signing secret. We deliberately
-- do NOT include `Secret` in the projection — if a future operator
-- rotates the secret, the audit diff will show "Secret column changed"
-- *via its absence* (it never appears on either side, so it never makes
-- it into AuditLog.OldValues / NewValues). The change itself is still
-- recorded as a generic UPDATE row with WHO + WHEN.
CREATE OR ALTER PROCEDURE dbo.usp_Webhook_GetById
    @WebhookId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1
           Id,
           WorkspaceId,
           Name,
           Url,
           Events,
           IsActive,
           CreatedAt
    FROM   dbo.Webhooks
    WHERE  Id = @WebhookId;
END;
GO
