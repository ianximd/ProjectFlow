-- Migration 0015: Audit Log
-- Append-only table for all write operations across the system

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'AuditLog' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.AuditLog (
    Id           UNIQUEIDENTIFIER  NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    WorkspaceId  NVARCHAR(255)     NULL,           -- NULL for system-level events
    UserId       NVARCHAR(255)     NOT NULL,
    UserEmail    NVARCHAR(320)     NULL,
    Action       NVARCHAR(50)      NOT NULL,        -- CREATE | UPDATE | DELETE | LOGIN | LOGOUT | ...
    Resource     NVARCHAR(100)     NOT NULL,        -- e.g. 'Task', 'Project', 'User'
    ResourceId   NVARCHAR(255)     NULL,
    OldValues    NVARCHAR(MAX)     NULL,            -- JSON
    NewValues    NVARCHAR(MAX)     NULL,            -- JSON
    IpAddress    NVARCHAR(50)      NULL,
    UserAgent    NVARCHAR(512)     NULL,
    CreatedAt    DATETIME2         NOT NULL DEFAULT GETUTCDATE()
  );
END;

-- Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_WorkspaceId' AND object_id = OBJECT_ID('dbo.AuditLog'))
  CREATE INDEX IX_AuditLog_WorkspaceId ON dbo.AuditLog (WorkspaceId, CreatedAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_UserId' AND object_id = OBJECT_ID('dbo.AuditLog'))
  CREATE INDEX IX_AuditLog_UserId ON dbo.AuditLog (UserId, CreatedAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_Resource' AND object_id = OBJECT_ID('dbo.AuditLog'))
  CREATE INDEX IX_AuditLog_Resource ON dbo.AuditLog (Resource, ResourceId, CreatedAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_CreatedAt' AND object_id = OBJECT_ID('dbo.AuditLog'))
  CREATE INDEX IX_AuditLog_CreatedAt ON dbo.AuditLog (CreatedAt DESC);
