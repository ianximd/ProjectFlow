-- =============================================================================
-- Migration 0051: Dashboards (Phase 9a)
-- A dashboard is a first-class, scoped, savable object; each card is a typed
-- config row resolved by card.service. Scope + visibility mirror SavedViews.
--   * Dashboards     — ScopeType/ScopeId/ScopePath/Visibility/IsDefault/Position (+ soft delete)
--   * DashboardCards — Type/Config (JSON) /Layout {x,y,w,h} (JSON) /Position
-- Idempotent (catalog guards), GO-batched.
-- (Renumbered from the plan's 0047 — Phases 6/7/8 landed at 0038–0050.)
-- Rollback in rollback/0051_dashboards.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Dashboards')
BEGIN
    CREATE TABLE dbo.Dashboards (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        ScopeType   NVARCHAR(12)     NOT NULL,           -- 'workspace'|'space'|'folder'|'list'
        ScopeId     UNIQUEIDENTIFIER NULL,
        ScopePath   NVARCHAR(900)    NULL,               -- materialized path of the scope node (for card scoping)
        Name        NVARCHAR(200)    NOT NULL,
        Description NVARCHAR(MAX)    NULL,
        Visibility  NVARCHAR(10)     NOT NULL CONSTRAINT DF_Dashboards_Visibility DEFAULT 'shared', -- 'private'|'shared'|'protected'
        OwnerId     UNIQUEIDENTIFIER NOT NULL,
        IsDefault   BIT              NOT NULL CONSTRAINT DF_Dashboards_IsDefault DEFAULT 0,
        Position    FLOAT            NOT NULL CONSTRAINT DF_Dashboards_Position  DEFAULT 0,
        CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_Dashboards_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL CONSTRAINT DF_Dashboards_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL,
        CONSTRAINT CK_Dashboards_ScopeType  CHECK (ScopeType IN ('workspace','space','folder','list')),
        CONSTRAINT CK_Dashboards_Visibility CHECK (Visibility IN ('private','shared','protected')),
        CONSTRAINT CK_Dashboards_ScopeId    CHECK (ScopeType = 'workspace' OR ScopeId IS NOT NULL),
        CONSTRAINT FK_Dashboards_Workspace  FOREIGN KEY (WorkspaceId) REFERENCES dbo.Workspaces(Id),
        CONSTRAINT FK_Dashboards_Owner      FOREIGN KEY (OwnerId)     REFERENCES dbo.Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Dashboards_Scope' AND object_id = OBJECT_ID('dbo.Dashboards'))
    CREATE NONCLUSTERED INDEX IX_Dashboards_Scope
        ON dbo.Dashboards (WorkspaceId, ScopeType, ScopeId, Position) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardCards')
BEGIN
    CREATE TABLE dbo.DashboardCards (
        Id          UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        DashboardId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_DashboardCards_Dashboard REFERENCES dbo.Dashboards(Id) ON DELETE CASCADE,
        Type        NVARCHAR(24)     NOT NULL,           -- card catalog token (wave-1 + 9b additions)
        Title       NVARCHAR(200)    NULL,
        Config      NVARCHAR(MAX)    NOT NULL,           -- JSON: data source + chart shape + per-card filter
        Layout      NVARCHAR(MAX)    NOT NULL,           -- JSON: { x, y, w, h }
        Position    FLOAT            NOT NULL CONSTRAINT DF_DashboardCards_Position  DEFAULT 0,
        CreatedAt   DATETIME2        NOT NULL CONSTRAINT DF_DashboardCards_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL CONSTRAINT DF_DashboardCards_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DashboardCards_Dashboard' AND object_id = OBJECT_ID('dbo.DashboardCards'))
    CREATE NONCLUSTERED INDEX IX_DashboardCards_Dashboard ON dbo.DashboardCards (DashboardId, Position);
GO
