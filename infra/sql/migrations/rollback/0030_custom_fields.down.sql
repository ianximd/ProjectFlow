-- =============================================================================
-- Rollback for 0030_custom_fields.sql. Run MANUALLY (the runner is forward-only).
-- Reverse dependency order, idempotent. Drops the auto-named DEFAULT constraint
-- on Projects.MultipleAssignees BEFORE the column (the 0029 Projects.Visibility lesson).
-- =============================================================================

-- Tasks.TaskTypeId: drop index, drop FK (dynamic name), drop column.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_TaskType' AND object_id = OBJECT_ID('dbo.Tasks'))
    DROP INDEX IX_Tasks_TaskType ON dbo.Tasks;
DECLARE @fkType NVARCHAR(128);
SELECT @fkType = fk.name FROM sys.foreign_keys fk
WHERE fk.parent_object_id = OBJECT_ID('dbo.Tasks') AND fk.referenced_object_id = OBJECT_ID('dbo.TaskTypes');
IF @fkType IS NOT NULL EXEC('ALTER TABLE dbo.Tasks DROP CONSTRAINT ' + @fkType);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Tasks') AND name = 'TaskTypeId')
    ALTER TABLE dbo.Tasks DROP COLUMN TaskTypeId;
GO

-- Child tables first.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskWatchers')           DROP TABLE dbo.TaskWatchers;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskCustomFieldValues')  DROP TABLE dbo.TaskCustomFieldValues;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CustomFields')           DROP TABLE dbo.CustomFields;
GO
-- TaskTypes after Tasks.TaskTypeId FK is gone.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskTypes')              DROP TABLE dbo.TaskTypes;
GO

-- Projects.MultipleAssignees was added NOT NULL DEFAULT 1 -> auto-named DEFAULT
-- constraint (DF__Projects__Multi__*). Drop it dynamically before DROP COLUMN
-- or the drop fails (Msg 5074 / 4922).
DECLARE @dfMA NVARCHAR(128);
SELECT @dfMA = dc.name FROM sys.default_constraints dc
WHERE dc.parent_object_id = OBJECT_ID('dbo.Projects')
  AND dc.parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.Projects'), 'MultipleAssignees', 'ColumnId');
IF @dfMA IS NOT NULL EXEC('ALTER TABLE dbo.Projects DROP CONSTRAINT ' + @dfMA);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'MultipleAssignees')
    ALTER TABLE dbo.Projects DROP COLUMN MultipleAssignees;
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0030_custom_fields.sql';
GO
