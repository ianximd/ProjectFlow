-- Rollback 0054: Scheduled Reports.
-- Drop the child run table first (its FK references ScheduledReports), then the
-- parent. DROP TABLE removes the table's own default/check constraints + indexes
-- with it, so no explicit constraint drops are needed.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ScheduledReportRuns') DROP TABLE dbo.ScheduledReportRuns;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ScheduledReports')    DROP TABLE dbo.ScheduledReports;
GO
