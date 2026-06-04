-- =============================================================================
-- Rollback for migration 0031 — restore the plain UNIQUE table constraint and
-- drop the filtered unique index. Idempotent.
--
-- NOTE: re-adding the plain constraint will fail if the table currently holds
-- soft-deleted rows that collide on (WorkspaceId, NameSingular) with an active
-- row — that is the exact situation 0031 fixed. Clean such rows before
-- rolling back if that applies.
-- =============================================================================

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_TaskTypes_Name_Active' AND object_id = OBJECT_ID('dbo.TaskTypes')
)
    DROP INDEX UX_TaskTypes_Name_Active ON dbo.TaskTypes;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'UQ_TaskTypes_Name' AND parent_object_id = OBJECT_ID('dbo.TaskTypes')
)
    ALTER TABLE dbo.TaskTypes ADD CONSTRAINT UQ_TaskTypes_Name UNIQUE (WorkspaceId, NameSingular);
GO

DELETE FROM dbo.MigrationHistory WHERE [FileName] = '0031_tasktype_name_filtered_unique.sql';
GO
