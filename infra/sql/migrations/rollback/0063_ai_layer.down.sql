-- =============================================================================
-- Rollback for 0063_ai_layer.sql. Run manually (forward-only runner). Idempotent.
-- Reverses: AiChunks FTS index + catalog (FTS-guarded), AiChunks table, AiRuns table.
-- =============================================================================

-- Drop FTS index before catalog (catalog drop requires no dependent indexes).
-- Guarded: only run DROP FULLTEXT ... when FTS is installed (otherwise the
-- objects cannot exist and the DROP would error on a no-FTS image).
IF CAST(SERVERPROPERTY('IsFullTextInstalled') AS INT) = 1
   AND EXISTS (SELECT 1 FROM sys.fulltext_indexes i
               JOIN sys.tables t ON t.object_id = i.object_id
               WHERE t.name = 'AiChunks')
    EXEC('DROP FULLTEXT INDEX ON dbo.AiChunks');
GO
IF CAST(SERVERPROPERTY('IsFullTextInstalled') AS INT) = 1
   AND EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'ftAiChunks')
    EXEC('DROP FULLTEXT CATALOG ftAiChunks');
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiChunks') DROP TABLE dbo.AiChunks;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiRuns') DROP TABLE dbo.AiRuns;
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0063_ai_layer.sql';
GO
