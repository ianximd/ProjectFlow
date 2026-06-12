-- Rollback 0044: timesheets.
-- Drops the Timesheets table (and its indexes/constraints, which go with it).

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Timesheets')
    DROP TABLE dbo.Timesheets;
GO
