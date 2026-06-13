-- =============================================================================
-- Migration 0049: Goals & Targets (Phase 8e, greenfield)
-- GoalFolders → Goals → Targets. A Target keeps CurrentValue (user-maintained
-- for number/currency/boolean, recomputed for kind='task' = completed over its
-- TaskFilter). Goal progress is computed on read (equal-weighted average of
-- target ratios) — no stored goal-progress column.
-- Idempotent (sys.tables / COL_LENGTH guards), GO-batched.
-- Rollback in rollback/0049_goals.down.sql.
--
-- NOTE: the Phase 8e plan named this 0046_goals, but 0046/0046b/0047/0048 were
-- consumed by Sprints (8c) and Workload/Box views (8d) after the plan was
-- written. Renumbered to 0049 (next free) — see DECISIONS.md §Phase 8e.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GoalFolders')
BEGIN
    CREATE TABLE dbo.GoalFolders (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        Name        NVARCHAR(200)    NOT NULL,
        OwnerId     UNIQUEIDENTIFIER NOT NULL,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GoalFolder_Workspace' AND object_id = OBJECT_ID('dbo.GoalFolders'))
    CREATE NONCLUSTERED INDEX IX_GoalFolder_Workspace ON dbo.GoalFolders (WorkspaceId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Goals')
BEGIN
    CREATE TABLE dbo.Goals (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        ScopeType   NVARCHAR(12)     NOT NULL DEFAULT 'WORKSPACE',  -- WORKSPACE|SPACE|FOLDER|LIST
        ScopeId     UNIQUEIDENTIFIER NULL,
        FolderId    UNIQUEIDENTIFIER NULL REFERENCES dbo.GoalFolders(Id),
        Name        NVARCHAR(300)    NOT NULL,
        Description NVARCHAR(MAX)    NULL,
        OwnerId     UNIQUEIDENTIFIER NOT NULL,
        DueDate     DATE             NULL,
        Status      NVARCHAR(12)     NOT NULL DEFAULT 'active',     -- active|achieved|archived
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt   DATETIME2        NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Goal_Workspace' AND object_id = OBJECT_ID('dbo.Goals'))
    CREATE NONCLUSTERED INDEX IX_Goal_Workspace ON dbo.Goals (WorkspaceId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Goal_Folder' AND object_id = OBJECT_ID('dbo.Goals'))
    CREATE NONCLUSTERED INDEX IX_Goal_Folder ON dbo.Goals (FolderId) WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Targets')
BEGIN
    CREATE TABLE dbo.Targets (
        Id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        GoalId       UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Goals(Id),
        Kind         NVARCHAR(10)     NOT NULL,                     -- number|boolean|currency|task
        Name         NVARCHAR(300)    NOT NULL,
        Unit         NVARCHAR(20)     NULL,
        CurrencyCode CHAR(3)          NULL,
        StartValue   FLOAT            NULL,
        TargetValue  FLOAT            NULL,
        CurrentValue FLOAT            NULL,
        TaskFilter   NVARCHAR(MAX)    NULL,                         -- JSON { taskIds:[...] } for Kind='task'
        Position     FLOAT            NOT NULL DEFAULT 0,
        CreatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Target_Goal' AND object_id = OBJECT_ID('dbo.Targets'))
    CREATE NONCLUSTERED INDEX IX_Target_Goal ON dbo.Targets (GoalId);
GO

-- Enum CHECK constraints (idempotent ALTER so this applies whether the table was
-- just created above or already exists from a prior 0049 apply). Mirrors the
-- repo-wide convention (CK_SavedViews_Type, CK_Timesheets_Status, CK_*_ScopeType,
-- etc.); the SP layer validates too, but the CHECK is the DB-level backstop — the
-- 8d lesson was a missing enum CHECK escaped unit+integration and only the live
-- e2e caught it.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Goals_Status')
    ALTER TABLE dbo.Goals WITH CHECK ADD CONSTRAINT CK_Goals_Status CHECK (Status IN ('active','achieved','archived'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Goals_ScopeType')
    ALTER TABLE dbo.Goals WITH CHECK ADD CONSTRAINT CK_Goals_ScopeType CHECK (ScopeType IN ('WORKSPACE','SPACE','FOLDER','LIST'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Targets_Kind')
    ALTER TABLE dbo.Targets WITH CHECK ADD CONSTRAINT CK_Targets_Kind CHECK (Kind IN ('number','boolean','currency','task'));
GO
