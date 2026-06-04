-- =============================================================================
-- Rollback for 0032_saved_views.sql. Run manually (forward-only runner).
-- Drops indexes before the table. Idempotent.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SavedViews_Owner' AND object_id = OBJECT_ID('dbo.SavedViews'))
    DROP INDEX IX_SavedViews_Owner ON dbo.SavedViews;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SavedViews_Scope' AND object_id = OBJECT_ID('dbo.SavedViews'))
    DROP INDEX IX_SavedViews_Scope ON dbo.SavedViews;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SavedViews')
    DROP TABLE dbo.SavedViews;
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0032_saved_views.sql';
GO
