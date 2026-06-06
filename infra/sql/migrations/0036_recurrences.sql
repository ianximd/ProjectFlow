-- =============================================================================
-- Migration 0036: Recurring tasks (Phase 5c)
-- New table: TaskRecurrences — one (active) recurrence rule per task. The rule
--   is stored as JSON; RegenerateMode drives on-complete and/or scheduled spawn.
--   NextRunAt feeds the BullMQ scheduler sweep; LastSpawnedTaskId points at the
--   most-recently spawned occurrence.
-- Indexes:
--   * UNIQUE filtered index on TaskId WHERE DeletedAt IS NULL — at most one
--     ACTIVE (non-soft-deleted) recurrence per task. SetForTask soft-deletes the
--     prior row before inserting, so the filter keeps replace semantics legal.
--   * (Active, NextRunAt) — covers the scheduler ListDue sweep.
-- Idempotent (sys-catalog guards), GO-batched.
-- Rollback in rollback/0036_recurrences.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskRecurrences')
BEGIN
    CREATE TABLE dbo.TaskRecurrences (
        Id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        TaskId              UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Tasks(Id),
        WorkspaceId         UNIQUEIDENTIFIER NOT NULL,
        [Rule]              NVARCHAR(MAX)    NOT NULL,                 -- JSON recurrence rule
        RegenerateMode      NVARCHAR(20)     NOT NULL,                -- 'on_complete' | 'schedule' | 'both'
        NextRunAt           DATETIME2        NULL,                    -- for scheduled mode
        Active              BIT              NOT NULL DEFAULT 1,
        LastSpawnedTaskId   UNIQUEIDENTIFIER NULL,
        IncludeDependencies BIT              NOT NULL DEFAULT 0,
        CreatedAt           DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt           DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DeletedAt           DATETIME2        NULL
    );
END
GO

-- One ACTIVE (non-deleted) recurrence per task. SetForTask soft-deletes any
-- prior row before inserting, so a replace never collides with this filter.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_TaskRecurrence_Task' AND object_id = OBJECT_ID('dbo.TaskRecurrences'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_TaskRecurrence_Task
        ON dbo.TaskRecurrences (TaskId) WHERE DeletedAt IS NULL;
GO

-- Scheduler sweep cover: WHERE Active = 1 AND NextRunAt <= @Now.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskRecurrence_Due' AND object_id = OBJECT_ID('dbo.TaskRecurrences'))
    CREATE NONCLUSTERED INDEX IX_TaskRecurrence_Due
        ON dbo.TaskRecurrences (Active, NextRunAt);
GO

-- Workspace scoping for any cross-tenant guards / future reverse lookups.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TaskRecurrence_Workspace' AND object_id = OBJECT_ID('dbo.TaskRecurrences'))
    CREATE NONCLUSTERED INDEX IX_TaskRecurrence_Workspace
        ON dbo.TaskRecurrences (WorkspaceId);
GO
