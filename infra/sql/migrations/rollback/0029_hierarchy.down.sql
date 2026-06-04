-- =============================================================================
-- Rollback for 0029_hierarchy.sql. Run manually (forward-only runner).
-- Drops in reverse dependency order. Idempotent.
-- =============================================================================
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_ListPath' AND object_id = OBJECT_ID('dbo.Tasks')) DROP INDEX IX_Tasks_ListPath ON dbo.Tasks;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_List'     AND object_id = OBJECT_ID('dbo.Tasks')) DROP INDEX IX_Tasks_List ON dbo.Tasks;
GO
-- Tasks.ListId FK to Lists — drop FK then columns.
DECLARE @fk NVARCHAR(128);
SELECT @fk = fk.name FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID('dbo.Tasks') AND fk.referenced_object_id = OBJECT_ID('dbo.Lists');
IF @fk IS NOT NULL EXEC('ALTER TABLE dbo.Tasks DROP CONSTRAINT ' + @fk);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ListPath')   ALTER TABLE dbo.Tasks DROP COLUMN ListPath;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ArchivedAt') ALTER TABLE dbo.Tasks DROP COLUMN ArchivedAt;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'ListId')     ALTER TABLE dbo.Tasks DROP COLUMN ListId;
GO
-- Workflows FKs to Folder/List
DECLARE @wfFk NVARCHAR(128);
SELECT @wfFk = fk.name FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID('dbo.Workflows') AND fk.referenced_object_id = OBJECT_ID('dbo.Lists');
IF @wfFk IS NOT NULL EXEC('ALTER TABLE dbo.Workflows DROP CONSTRAINT ' + @wfFk);
SELECT @wfFk = fk.name FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID('dbo.Workflows') AND fk.referenced_object_id = OBJECT_ID('dbo.Folders');
IF @wfFk IS NOT NULL EXEC('ALTER TABLE dbo.Workflows DROP CONSTRAINT ' + @wfFk);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Workflows') AND name = 'ListId')   ALTER TABLE dbo.Workflows DROP COLUMN ListId;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Workflows') AND name = 'FolderId') ALTER TABLE dbo.Workflows DROP COLUMN FolderId;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ObjectPermissions') DROP TABLE dbo.ObjectPermissions;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Lists')             DROP TABLE dbo.Lists;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Folders')           DROP TABLE dbo.Folders;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Projects_Visibility') ALTER TABLE dbo.Projects DROP CONSTRAINT CK_Projects_Visibility;
-- Projects.Visibility was added as NOT NULL DEFAULT 'PUBLIC', creating an
-- auto-named DEFAULT constraint (DF__Projects__Visibi__*). It must be dropped
-- before the column, or DROP COLUMN fails (Msg 5074 / 4922).
DECLARE @dfVis NVARCHAR(128);
SELECT @dfVis = dc.name FROM sys.default_constraints dc
WHERE dc.parent_object_id = OBJECT_ID('dbo.Projects')
  AND dc.parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.Projects'), 'Visibility', 'ColumnId');
IF @dfVis IS NOT NULL EXEC('ALTER TABLE dbo.Projects DROP CONSTRAINT ' + @dfVis);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'MaxSubtaskDepth') ALTER TABLE dbo.Projects DROP COLUMN MaxSubtaskDepth;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'Visibility')      ALTER TABLE dbo.Projects DROP COLUMN Visibility;
GO
-- MigrationHistory filename column confirmed as [FileName] (scripts/db-migrate.ts).
DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0029_hierarchy.sql';
GO
