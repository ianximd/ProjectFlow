-- Rollback 0036: recurring tasks.
-- Drops the TaskRecurrences table (and its indexes, which go with it).

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskRecurrences')
    DROP TABLE dbo.TaskRecurrences;
GO
