-- Migration 0014: Outgoing webhooks + delivery log

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Webhooks')
CREATE TABLE dbo.Webhooks (
  Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id) ON DELETE CASCADE,
  Name        NVARCHAR(100)    NOT NULL,
  Url         NVARCHAR(500)    NOT NULL,
  Secret      NVARCHAR(255)    NOT NULL,  -- HMAC-SHA256 signing secret (stored hashed)
  Events      NVARCHAR(MAX)    NOT NULL,  -- JSON array e.g. ["issue.created","sprint.started"]
  IsActive    BIT              NOT NULL DEFAULT 1,
  CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Webhook_Url CHECK (Url LIKE 'https://%' OR Url LIKE 'http://%')
);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WebhookDeliveries')
CREATE TABLE dbo.WebhookDeliveries (
  Id             UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  WebhookId      UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Webhooks(Id) ON DELETE CASCADE,
  Event          NVARCHAR(50)     NOT NULL,
  Payload        NVARCHAR(MAX)    NOT NULL,  -- JSON body sent
  StatusCode     INT              NULL,      -- HTTP response code (NULL = not delivered yet)
  ResponseBody   NVARCHAR(MAX)    NULL,
  DurationMs     INT              NULL,
  Attempt        INT              NOT NULL DEFAULT 1,
  DeliveredAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  Success        BIT              NOT NULL DEFAULT 0
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Webhooks_WorkspaceId')
CREATE INDEX IX_Webhooks_WorkspaceId
  ON dbo.Webhooks (WorkspaceId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebhookDeliveries_WebhookId')
CREATE INDEX IX_WebhookDeliveries_WebhookId
  ON dbo.WebhookDeliveries (WebhookId, DeliveredAt DESC);
