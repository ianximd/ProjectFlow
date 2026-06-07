-- =============================================================================
-- Migration 0038: Automation scope (Phase 6a)
-- Extends AutomationRules from project-only to PROJECT + WORKSPACE scope:
--   * ScopeType  ('WORKSPACE' | 'PROJECT', default 'PROJECT')
--   * WorkspaceId (denormalized; backfilled from Projects via ProjectId)
--   * ProjectId relaxed to NULL (null when ScopeType='WORKSPACE')
--   * ScopeId (maintained column = WorkspaceId for WORKSPACE rules else ProjectId)
--   * IX_AutomationRule_Scope (ScopeType, ScopeId, IsEnabled) — the hot lookup
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0038_automation_scope.down.sql.
-- =============================================================================

IF COL_LENGTH('dbo.AutomationRules', 'ScopeType') IS NULL
    ALTER TABLE dbo.AutomationRules
        ADD ScopeType NVARCHAR(12) NOT NULL
            CONSTRAINT DF_AutomationRules_ScopeType DEFAULT 'PROJECT';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AutomationRules_ScopeType')
    ALTER TABLE dbo.AutomationRules
        ADD CONSTRAINT CK_AutomationRules_ScopeType CHECK (ScopeType IN ('WORKSPACE','PROJECT'));
GO

IF COL_LENGTH('dbo.AutomationRules', 'WorkspaceId') IS NULL
    ALTER TABLE dbo.AutomationRules ADD WorkspaceId UNIQUEIDENTIFIER NULL;
GO

-- Backfill WorkspaceId from the owning project for every existing (project-scoped) rule.
UPDATE ar
   SET ar.WorkspaceId = p.WorkspaceId
  FROM dbo.AutomationRules ar
  JOIN dbo.Projects        p ON p.Id = ar.ProjectId
 WHERE ar.WorkspaceId IS NULL;
GO

-- Now enforce NOT NULL on WorkspaceId (all rows are backfilled above).
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.AutomationRules')
             AND name = 'WorkspaceId' AND is_nullable = 1)
    ALTER TABLE dbo.AutomationRules ALTER COLUMN WorkspaceId UNIQUEIDENTIFIER NOT NULL;
GO

-- Relax ProjectId to NULL (workspace-scoped rules carry no project).
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.AutomationRules')
             AND name = 'ProjectId' AND is_nullable = 0)
    ALTER TABLE dbo.AutomationRules ALTER COLUMN ProjectId UNIQUEIDENTIFIER NULL;
GO

-- ScopeId — maintained column (not computed, so it is indexable + SP-maintained).
IF COL_LENGTH('dbo.AutomationRules', 'ScopeId') IS NULL
    ALTER TABLE dbo.AutomationRules ADD ScopeId UNIQUEIDENTIFIER NULL;
GO

-- Backfill ScopeId for existing rows (all PROJECT-scoped at this point).
UPDATE dbo.AutomationRules
   SET ScopeId = CASE WHEN ScopeType = 'WORKSPACE' THEN WorkspaceId ELSE ProjectId END
 WHERE ScopeId IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_AutomationRule_Scope'
                 AND object_id = OBJECT_ID('dbo.AutomationRules'))
    CREATE INDEX IX_AutomationRule_Scope
        ON dbo.AutomationRules (ScopeType, ScopeId, IsEnabled);
GO
