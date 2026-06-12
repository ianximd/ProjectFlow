-- =============================================================================
-- Migration 0044: Timesheets (Phase 8b)
-- New table: Timesheets — the submit/approve envelope over WorkLogs. Line data
--   is the existing WorkLogs aggregated within [PeriodStart, PeriodEnd]; this
--   table only carries Status + review metadata. One envelope per
--   (UserId, PeriodStart, PeriodEnd) — enforced by UQ_Timesheet_Period.
-- Idempotent (sys-catalog guards), GO-batched.
-- Rollback in rollback/0044_timesheets.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Timesheets')
BEGIN
    CREATE TABLE dbo.Timesheets (
        Id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Timesheets PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId   UNIQUEIDENTIFIER NOT NULL,
        UserId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_Timesheets_User REFERENCES dbo.Users(Id),
        PeriodStart   DATE             NOT NULL,
        PeriodEnd     DATE             NOT NULL,
        Status        NVARCHAR(12)     NOT NULL CONSTRAINT DF_Timesheets_Status DEFAULT 'draft',
        SubmittedAt   DATETIME2        NULL,
        ReviewedById  UNIQUEIDENTIFIER NULL CONSTRAINT FK_Timesheets_Reviewer REFERENCES dbo.Users(Id),
        ReviewedAt    DATETIME2        NULL,
        Note          NVARCHAR(500)    NULL,
        CreatedAt     DATETIME2        NOT NULL CONSTRAINT DF_Timesheets_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2        NOT NULL CONSTRAINT DF_Timesheets_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_Timesheets_Status CHECK (Status IN ('draft','submitted','approved','rejected'))
    );
END
GO

-- One envelope per user + period window.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Timesheet_Period' AND object_id = OBJECT_ID('dbo.Timesheets'))
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Timesheet_Period
        ON dbo.Timesheets (UserId, PeriodStart, PeriodEnd);
GO

-- Workspace + status scan cover for the list/review surfaces.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Timesheet_Workspace' AND object_id = OBJECT_ID('dbo.Timesheets'))
    CREATE NONCLUSTERED INDEX IX_Timesheet_Workspace
        ON dbo.Timesheets (WorkspaceId, Status)
        INCLUDE (UserId, PeriodStart, PeriodEnd);
GO
