-- Rollback 0038: automation scope.
-- Drops the scope index + columns (with their DEFAULT/CHECK constraints) and
-- restores ProjectId NOT NULL. Pre-existing rows are all PROJECT-scoped after a
-- forward apply, so restoring ProjectId NOT NULL is safe.

IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'IX_AutomationRule_Scope'
             AND object_id = OBJECT_ID('dbo.AutomationRules'))
    DROP INDEX IX_AutomationRule_Scope ON dbo.AutomationRules;
GO

IF COL_LENGTH('dbo.AutomationRules', 'ScopeId') IS NOT NULL
    ALTER TABLE dbo.AutomationRules DROP COLUMN ScopeId;
GO

-- Restore ProjectId NOT NULL before dropping WorkspaceId (project-scoped only).
-- IX_AutomationRule_Project (from migration 0009) is keyed on ProjectId and
-- blocks the NULL→NOT NULL alter (SQL Server forbids altering a column an index
-- depends on), so drop it, restore NOT NULL, then recreate it identically.
IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'IX_AutomationRule_Project'
             AND object_id = OBJECT_ID('dbo.AutomationRules'))
    DROP INDEX IX_AutomationRule_Project ON dbo.AutomationRules;
GO

IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.AutomationRules')
             AND name = 'ProjectId' AND is_nullable = 1)
    ALTER TABLE dbo.AutomationRules ALTER COLUMN ProjectId UNIQUEIDENTIFIER NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_AutomationRule_Project'
                 AND object_id = OBJECT_ID('dbo.AutomationRules'))
    CREATE INDEX IX_AutomationRule_Project ON dbo.AutomationRules(ProjectId);
GO

IF COL_LENGTH('dbo.AutomationRules', 'WorkspaceId') IS NOT NULL
    ALTER TABLE dbo.AutomationRules DROP COLUMN WorkspaceId;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AutomationRules_ScopeType')
    ALTER TABLE dbo.AutomationRules DROP CONSTRAINT CK_AutomationRules_ScopeType;
GO
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_AutomationRules_ScopeType')
    ALTER TABLE dbo.AutomationRules DROP CONSTRAINT DF_AutomationRules_ScopeType;
IF COL_LENGTH('dbo.AutomationRules', 'ScopeType') IS NOT NULL
    ALTER TABLE dbo.AutomationRules DROP COLUMN ScopeType;
GO
