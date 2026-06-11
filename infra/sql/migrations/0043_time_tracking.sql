-- =============================================================================
-- Migration 0043: Time Tracking (Phase 8a)
-- Evolves WorkLogs into a timer + estimate system:
--   * EndedAt (NULL = running timer), Billable, Source ('manual'|'range'|'timer')
--   * UQ_WorkLog_ActiveTimer — at most one OPEN (EndedAt IS NULL) entry per user
--   * WorkLogTags — entry tags, reusing the Phase 2 Space-scoped Tags
--   * Tasks.TimeEstimateSeconds + TaskEstimates(TaskId,UserId) for per-assignee estimates
-- Idempotent (catalog guards), GO-batched.
-- Rollback in rollback/0043_time_tracking.down.sql.
-- =============================================================================

IF COL_LENGTH('dbo.WorkLogs', 'EndedAt') IS NULL
    ALTER TABLE dbo.WorkLogs ADD EndedAt DATETIME2 NULL;
GO

IF COL_LENGTH('dbo.WorkLogs', 'Billable') IS NULL
    ALTER TABLE dbo.WorkLogs ADD Billable BIT NOT NULL CONSTRAINT DF_WorkLogs_Billable DEFAULT 0;
GO

IF COL_LENGTH('dbo.WorkLogs', 'Source') IS NULL
    ALTER TABLE dbo.WorkLogs ADD Source NVARCHAR(10) NOT NULL CONSTRAINT DF_WorkLogs_Source DEFAULT 'manual';
GO

-- At most one OPEN timer per user. Manual/range entries always set EndedAt, so
-- only live timer rows fall under the filter.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_WorkLog_ActiveTimer' AND object_id = OBJECT_ID('dbo.WorkLogs'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_WorkLog_ActiveTimer
        ON dbo.WorkLogs (UserId) WHERE EndedAt IS NULL;
GO

-- Dual ON DELETE CASCADE (→WorkLogs and →Labels) is safe: only the
-- Projects→Labels→WorkLogTags arm cascades. Projects→Tasks is NO ACTION (init
-- migration), so there is no multiple-cascade-path to WorkLogTags. Do not change
-- Tasks.ProjectId to ON DELETE CASCADE without revisiting this.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkLogTags')
BEGIN
    CREATE TABLE dbo.WorkLogTags (
        WorkLogId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_WorkLogTags_WorkLog REFERENCES dbo.WorkLogs(Id) ON DELETE CASCADE,
        -- "Tags" are stored in dbo.Labels (Space-scoped); see migration 0011.
        TagId     UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_WorkLogTags_Tag     REFERENCES dbo.Labels(Id)   ON DELETE CASCADE,
        CONSTRAINT PK_WorkLogTags PRIMARY KEY (WorkLogId, TagId)
    );
END
GO

IF COL_LENGTH('dbo.Tasks', 'TimeEstimateSeconds') IS NULL
    ALTER TABLE dbo.Tasks ADD TimeEstimateSeconds INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskEstimates')
BEGIN
    CREATE TABLE dbo.TaskEstimates (
        TaskId          UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_TaskEstimates_Task REFERENCES dbo.Tasks(Id) ON DELETE CASCADE,
        UserId          UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_TaskEstimates_User REFERENCES dbo.Users(Id),
        EstimateSeconds INT              NOT NULL,
        CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_TaskEstimates_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL CONSTRAINT DF_TaskEstimates_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TaskEstimates PRIMARY KEY (TaskId, UserId)
    );
END
GO
