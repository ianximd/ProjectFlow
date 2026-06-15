-- =============================================================================
-- Migration 0058: Apps / feature toggles (Phase 10a)
-- AppsEnabled stores ONLY overrides; the default-on registry of app keys lives
-- in code (apps/api/src/modules/apps/app-registry.ts). Resolution walks the
-- hierarchy ancestry (workspace -> space -> folder -> list) and the most-specific
-- override wins, falling back to the registry default. Mirrors the ObjectPermissions
-- ancestry model from 0029 (usp_ObjectAccess_Resolve's Path LIKE scan).
-- The app.manage RBAC slug is seeded SEPARATELY in 0059_app_perms.sql (the
-- two-file table/perms convention adopted by 0051/0052, 0054/0055, etc.).
-- Idempotent (catalog guards), GO-batched.
-- (Renumbered from the plan's 0051 -- on-disk migration tip was 0057.)
-- Rollback in rollback/0058_apps_enabled.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AppsEnabled')
BEGIN
    CREATE TABLE dbo.AppsEnabled (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Workspaces(Id),
        ScopeType   NVARCHAR(12)     NOT NULL,            -- 'workspace'|'space'|'folder'|'list'
        ScopeId     UNIQUEIDENTIFIER NULL,                -- NULL when ScopeType='workspace'
        AppKey      NVARCHAR(40)     NOT NULL,
        Enabled     BIT              NOT NULL,
        UpdatedBy   UNIQUEIDENTIFIER NULL REFERENCES dbo.Users(Id),
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_AppsEnabled_ScopeType CHECK (ScopeType IN ('workspace','space','folder','list')),
        -- One override per (scope, app). SQL Server treats NULL as a single value
        -- in a UNIQUE index, so at most one workspace-level override per
        -- (WorkspaceId, AppKey) (ScopeId NULL participates as one distinct slot).
        CONSTRAINT UQ_AppsEnabled UNIQUE (WorkspaceId, ScopeType, ScopeId, AppKey)
    );
    CREATE NONCLUSTERED INDEX IX_AppsEnabled_Scope ON dbo.AppsEnabled (ScopeType, ScopeId);
    CREATE NONCLUSTERED INDEX IX_AppsEnabled_Ws    ON dbo.AppsEnabled (WorkspaceId, AppKey);
END
GO
