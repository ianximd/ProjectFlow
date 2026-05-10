-- Migration 0013: Slack / Microsoft Teams integration connections

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'IntegrationConnections')
CREATE TABLE dbo.IntegrationConnections (
  Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id) ON DELETE CASCADE,
  Provider    NVARCHAR(20)     NOT NULL,    -- 'slack' | 'msteams'
  ChannelName NVARCHAR(255)    NOT NULL,    -- human-readable label (e.g. "#dev-alerts")
  WebhookUrl  NVARCHAR(2000)   NOT NULL,    -- Incoming Webhook URL
  Events      NVARCHAR(MAX)    NOT NULL     -- JSON array of subscribed event names
              DEFAULT '["task.created","task.transitioned","sprint.started","sprint.completed"]',
  IsActive    BIT              NOT NULL DEFAULT 1,
  CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_IntConn_Provider CHECK (Provider IN ('slack', 'msteams'))
);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_IntegrationConnections_WorkspaceId'
)
CREATE INDEX IX_IntegrationConnections_WorkspaceId
  ON dbo.IntegrationConnections (WorkspaceId);
