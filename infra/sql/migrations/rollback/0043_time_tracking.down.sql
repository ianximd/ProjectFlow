-- Rollback 0043: Time Tracking.
-- Drops TaskEstimates, WorkLogTags, the active-timer index, and the new
-- WorkLogs/Tasks columns (with their DEFAULT constraints) in reverse order.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskEstimates') DROP TABLE dbo.TaskEstimates;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkLogTags')   DROP TABLE dbo.WorkLogTags;
GO

IF COL_LENGTH('dbo.Tasks', 'TimeEstimateSeconds') IS NOT NULL
    ALTER TABLE dbo.Tasks DROP COLUMN TimeEstimateSeconds;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_WorkLog_ActiveTimer' AND object_id = OBJECT_ID('dbo.WorkLogs'))
    DROP INDEX UQ_WorkLog_ActiveTimer ON dbo.WorkLogs;
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_WorkLogs_Source')
    ALTER TABLE dbo.WorkLogs DROP CONSTRAINT DF_WorkLogs_Source;
IF COL_LENGTH('dbo.WorkLogs', 'Source') IS NOT NULL   ALTER TABLE dbo.WorkLogs DROP COLUMN Source;
GO
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_WorkLogs_Billable')
    ALTER TABLE dbo.WorkLogs DROP CONSTRAINT DF_WorkLogs_Billable;
IF COL_LENGTH('dbo.WorkLogs', 'Billable') IS NOT NULL ALTER TABLE dbo.WorkLogs DROP COLUMN Billable;
GO
IF COL_LENGTH('dbo.WorkLogs', 'EndedAt') IS NOT NULL  ALTER TABLE dbo.WorkLogs DROP COLUMN EndedAt;
GO
