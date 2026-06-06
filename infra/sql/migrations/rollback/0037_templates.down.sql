-- Rollback 0037: templates.
-- Drops the Templates table (and its index, which goes with it).

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Templates')
    DROP TABLE dbo.Templates;
GO
