-- =============================================================================
-- Migration 0054: Scheduled Reports (Phase 9c)
-- New tables:
--   ScheduledReports    — binds a Dashboard (or a single report) to a recurring
--     cadence (RRULE-ish, reusing the Phase 5 recurrence rule shape) + a recipient
--     set + a delivery channel ('inbox' now; 'email' deferred to Phase 12). The
--     sweep reads NextRunAt to decide what is due.
--   ScheduledReportRuns — an audit row per delivered period. UNIQUE(ScheduledReportId,
--     PeriodKey) makes delivery IDEMPOTENT PER PERIOD: a worker restart mid-period
--     re-attempts the same PeriodKey and the INSERT is a no-op, so a report is never
--     double-delivered.
-- NOTE (vs the plan): the plan numbered this 0048, but 0048-0053 were taken by
--   8c/8d/8e/9a/9b. Renumbered to 0054 (highest on disk was 0053_report_perms).
--   DashboardId is a plain column (NO FK to Dashboards) — a schedule survives a
--   dashboard delete (its runs/snapshots are still readable history) and it dodges
--   cascade/truncate-order coupling. Tenant safety comes from WorkspaceId + the
--   owner-scoped card resolve at snapshot time, not an FK.
-- Idempotent (sys-catalog guards), GO-batched.
-- Rollback in rollback/0054_scheduled_reports.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ScheduledReports')
BEGIN
    CREATE TABLE dbo.ScheduledReports (
        Id              UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId     UNIQUEIDENTIFIER NOT NULL,
        DashboardId     UNIQUEIDENTIFIER NULL,        -- references Dashboards (Phase 9a); NULL when scheduling a single report
        ReportKind      NVARCHAR(24)     NULL,        -- when scheduling a single report instead of a dashboard
        ReportParams    NVARCHAR(MAX)    NULL,        -- JSON params for the single-report path
        Cadence         NVARCHAR(MAX)    NOT NULL,    -- RRULE-ish JSON (reuse the Phase 5 recurrence rule shape)
        DeliveryChannel NVARCHAR(10)     NOT NULL
            CONSTRAINT DF_ScheduledReports_Channel DEFAULT 'inbox',  -- 'inbox' | 'email' (email deferred)
        Recipients      NVARCHAR(MAX)    NOT NULL,    -- JSON array of user ids (+ external emails once email lands)
        Enabled         BIT              NOT NULL
            CONSTRAINT DF_ScheduledReports_Enabled DEFAULT 1,
        NextRunAt       DATETIME2        NULL,
        OwnerId         UNIQUEIDENTIFIER NOT NULL,
        CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_ScheduledReports_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL CONSTRAINT DF_ScheduledReports_UpdatedAt DEFAULT SYSUTCDATETIME(),
        DeletedAt       DATETIME2        NULL,
        CONSTRAINT CK_ScheduledReports_Channel CHECK (DeliveryChannel IN ('inbox','email'))
    );
END
GO

-- The sweep cover: enabled, live schedules ordered by NextRunAt.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduledReports_Due' AND object_id = OBJECT_ID('dbo.ScheduledReports'))
    CREATE NONCLUSTERED INDEX IX_ScheduledReports_Due
        ON dbo.ScheduledReports (NextRunAt)
        WHERE Enabled = 1 AND DeletedAt IS NULL;
GO

-- Editor list cover: a workspace's live schedules.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduledReports_Workspace' AND object_id = OBJECT_ID('dbo.ScheduledReports'))
    CREATE NONCLUSTERED INDEX IX_ScheduledReports_Workspace
        ON dbo.ScheduledReports (WorkspaceId)
        WHERE DeletedAt IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ScheduledReportRuns')
BEGIN
    CREATE TABLE dbo.ScheduledReportRuns (
        Id                UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        ScheduledReportId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT FK_ScheduledReportRuns_Schedule REFERENCES dbo.ScheduledReports(Id) ON DELETE CASCADE,
        PeriodKey         NVARCHAR(40)     NOT NULL,   -- stable per-occurrence key (the occurrence ISO timestamp)
        RanAt             DATETIME2        NOT NULL CONSTRAINT DF_ScheduledReportRuns_RanAt DEFAULT SYSUTCDATETIME(),
        Status            NVARCHAR(12)     NOT NULL CONSTRAINT DF_ScheduledReportRuns_Status DEFAULT 'delivered', -- 'delivered'|'failed'|'skipped'
        SnapshotRef       NVARCHAR(MAX)    NULL,       -- frozen render payload (JSON) or an external ref
        Error             NVARCHAR(MAX)    NULL,
        -- Idempotency: at most ONE run per (schedule, period). A re-attempt of the
        -- same period (worker restart) hits this constraint → no double-delivery.
        CONSTRAINT UQ_ScheduledReportRuns_Period UNIQUE (ScheduledReportId, PeriodKey)
    );
END
GO
