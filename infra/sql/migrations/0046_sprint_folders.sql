-- =============================================================================
-- Migration 0046: Sprint-folder hierarchy (Phase 8c)
-- A Sprint becomes a List under a sprint-flagged Folder.
--   * Folders.IsSprintFolder  — marks a folder as a sprint container.
--   * SprintSettings           — 1:1 with the sprint Folder: cadence + auto flags
--                                + the points field to roll up.
--   * Sprints.ListId/FolderId  — bind the existing flat row to its List + Folder.
--                                ProjectId is retained (denormalized) for back-compat.
-- Data migration of legacy flat sprints lives in 0046b_sprint_data_migration.sql.
-- The new `sprint.manage` RBAC slug is seeded in 0047_sprint_manage_perm.sql.
-- Idempotent (sys-catalog / COL_LENGTH guards), GO-batched.
-- Rollback in rollback/0046_sprint_folders.down.sql.
--
-- NOTE (renumbered from the plan's 0045 — 0044/0045 were taken by Phase 8b
-- timesheets). Local DB advances 0045 -> 0046.
-- =============================================================================

IF COL_LENGTH('dbo.Folders','IsSprintFolder') IS NULL
    ALTER TABLE dbo.Folders ADD IsSprintFolder BIT NOT NULL DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SprintSettings')
BEGIN
    CREATE TABLE dbo.SprintSettings (
        FolderId        UNIQUEIDENTIFIER PRIMARY KEY REFERENCES dbo.Folders(Id),
        DurationDays    INT              NOT NULL DEFAULT 14,
        StartDayOfWeek  TINYINT          NULL,            -- 0=Sun..6=Sat; NULL = anchor to prior EndDate
        AutoStart       BIT              NOT NULL DEFAULT 0,
        AutoComplete    BIT              NOT NULL DEFAULT 0,
        AutoRollForward BIT              NOT NULL DEFAULT 0,
        PointsFieldId   UNIQUEIDENTIFIER NULL,            -- NULL = use Tasks.StoryPoints
        CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF COL_LENGTH('dbo.Sprints','ListId') IS NULL
    ALTER TABLE dbo.Sprints ADD ListId UNIQUEIDENTIFIER NULL REFERENCES dbo.Lists(Id);
GO
IF COL_LENGTH('dbo.Sprints','FolderId') IS NULL
    ALTER TABLE dbo.Sprints ADD FolderId UNIQUEIDENTIFIER NULL REFERENCES dbo.Folders(Id);
GO

-- 1:1 sprint<->List: at most one sprint bound to a List.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Sprint_List' AND object_id = OBJECT_ID('dbo.Sprints'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Sprint_List ON dbo.Sprints (ListId) WHERE ListId IS NOT NULL;
GO

-- Sweep cover: folder lookup + (Status, EndDate) for auto-complete scans.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sprint_Folder' AND object_id = OBJECT_ID('dbo.Sprints'))
    CREATE NONCLUSTERED INDEX IX_Sprint_Folder ON dbo.Sprints (FolderId, Status, EndDate);
GO
