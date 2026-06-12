-- Rollback 0046: sprint-folder hierarchy.
-- The up migration creates auto-named constraints (inline FK REFERENCES on
-- Sprints.ListId/FolderId; DEFAULT 0 on Folders.IsSprintFolder), so the columns
-- can't be dropped until those constraints are dropped by dynamic lookup.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sprint_Folder' AND object_id = OBJECT_ID('dbo.Sprints'))
    DROP INDEX IX_Sprint_Folder ON dbo.Sprints;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Sprint_List' AND object_id = OBJECT_ID('dbo.Sprints'))
    DROP INDEX UQ_Sprint_List ON dbo.Sprints;
GO

-- Drop the FK on Sprints.FolderId (auto-named), then the column.
DECLARE @fkF NVARCHAR(128);
SELECT @fkF = fk.name
FROM   sys.foreign_keys fk
JOIN   sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN   sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
WHERE  fk.parent_object_id = OBJECT_ID('dbo.Sprints') AND c.name = 'FolderId';
IF @fkF IS NOT NULL EXEC('ALTER TABLE dbo.Sprints DROP CONSTRAINT ' + @fkF);
IF COL_LENGTH('dbo.Sprints','FolderId') IS NOT NULL
    ALTER TABLE dbo.Sprints DROP COLUMN FolderId;
GO

-- Drop the FK on Sprints.ListId (auto-named), then the column.
DECLARE @fkL NVARCHAR(128);
SELECT @fkL = fk.name
FROM   sys.foreign_keys fk
JOIN   sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN   sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
WHERE  fk.parent_object_id = OBJECT_ID('dbo.Sprints') AND c.name = 'ListId';
IF @fkL IS NOT NULL EXEC('ALTER TABLE dbo.Sprints DROP CONSTRAINT ' + @fkL);
IF COL_LENGTH('dbo.Sprints','ListId') IS NOT NULL
    ALTER TABLE dbo.Sprints DROP COLUMN ListId;
GO

-- SprintSettings carries an FK to Folders (FolderId PK REFERENCES) — dropping the
-- table removes that constraint too.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SprintSettings')
    DROP TABLE dbo.SprintSettings;
GO

-- Drop the auto-named DEFAULT 0 constraint on Folders.IsSprintFolder, then the column.
DECLARE @dfF NVARCHAR(128);
SELECT @dfF = dc.name
FROM   sys.default_constraints dc
JOIN   sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE  dc.parent_object_id = OBJECT_ID('dbo.Folders') AND c.name = 'IsSprintFolder';
IF @dfF IS NOT NULL EXEC('ALTER TABLE dbo.Folders DROP CONSTRAINT ' + @dfF);
IF COL_LENGTH('dbo.Folders','IsSprintFolder') IS NOT NULL
    ALTER TABLE dbo.Folders DROP COLUMN IsSprintFolder;
GO
