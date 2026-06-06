-- =============================================================================
-- Migration 0037: Templates (Phase 5d)
-- New table: Templates — one reusable template per saved subtree. The captured
--   subtree + settings are stored as a single JSON blob in Snapshot, with every
--   date encoded as a day-offset from a reference anchor (so apply can remap to
--   a chosen anchor date). ScopeType marks what kind of node was captured.
-- Index:
--   * (WorkspaceId, ScopeType) filtered WHERE DeletedAt IS NULL — the Template
--     Center lists a workspace's live templates, optionally narrowed by scope.
-- Idempotent (sys-catalog guards), GO-batched.
-- Rollback in rollback/0037_templates.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Templates')
BEGIN
    CREATE TABLE dbo.Templates (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        ScopeType   NVARCHAR(8)      NOT NULL,   -- 'TASK' | 'LIST' | 'FOLDER' | 'SPACE'
        Name        NVARCHAR(255)    NOT NULL,
        Description NVARCHAR(MAX)    NULL,
        Snapshot    NVARCHAR(MAX)    NOT NULL,   -- JSON subtree + settings; dates as day-offsets
        CreatedById UNIQUEIDENTIFIER NOT NULL,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL,
        CONSTRAINT CK_Templates_Scope CHECK (ScopeType IN ('TASK','LIST','FOLDER','SPACE'))
    );
END
GO

-- Template Center cover: workspace templates, optionally narrowed by scope.
-- Filtered so the index only carries live (non-soft-deleted) templates.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Templates_Workspace_Scope' AND object_id = OBJECT_ID('dbo.Templates'))
    CREATE NONCLUSTERED INDEX IX_Templates_Workspace_Scope
        ON dbo.Templates (WorkspaceId, ScopeType) WHERE DeletedAt IS NULL;
GO
