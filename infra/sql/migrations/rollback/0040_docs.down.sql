-- =============================================================================
-- Rollback for 0040_docs.sql. Run manually (forward-only runner).
-- Drops the four Docs tables (children first to satisfy FKs), then the
-- MigrationHistory row. Idempotent.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocTaskLinks')    DROP TABLE dbo.DocTaskLinks;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocPageVersions') DROP TABLE dbo.DocPageVersions;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocPages')        DROP TABLE dbo.DocPages;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Docs')            DROP TABLE dbo.Docs;
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0040_docs.sql';
GO
