-- =============================================================================
-- Rollback for 0041_whiteboards.sql. Run manually (forward-only runner).
-- Drops the link table + indexes before the parent table. Idempotent.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WhiteboardTaskLinks_Whiteboard' AND object_id = OBJECT_ID('dbo.WhiteboardTaskLinks'))
    DROP INDEX IX_WhiteboardTaskLinks_Whiteboard ON dbo.WhiteboardTaskLinks;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WhiteboardTaskLinks')
    DROP TABLE dbo.WhiteboardTaskLinks;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Whiteboards_Scope' AND object_id = OBJECT_ID('dbo.Whiteboards'))
    DROP INDEX IX_Whiteboards_Scope ON dbo.Whiteboards;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Whiteboards')
    DROP TABLE dbo.Whiteboards;
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0041_whiteboards.sql';
GO
