-- =============================================================================
-- Migration 0031: TaskTypes name uniqueness ignores soft-deleted rows.
--
-- The 0030 table constraint `UQ_TaskTypes_Name UNIQUE (WorkspaceId,
-- NameSingular)` also counted soft-deleted rows (DeletedAt IS NOT NULL). So
-- once a workspace's default "Task" type was soft-deleted, re-running the 0030
-- backfill — or a user creating a new type that reuses a soft-deleted name —
-- failed with a 2627 duplicate-key error (a hard crash / 500).
--
-- Replace the constraint with a FILTERED unique index that only constrains
-- ACTIVE rows (DeletedAt IS NULL). Idempotent + GO-batched.
-- =============================================================================

IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'UQ_TaskTypes_Name' AND parent_object_id = OBJECT_ID('dbo.TaskTypes')
)
    ALTER TABLE dbo.TaskTypes DROP CONSTRAINT UQ_TaskTypes_Name;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_TaskTypes_Name_Active' AND object_id = OBJECT_ID('dbo.TaskTypes')
)
    CREATE UNIQUE NONCLUSTERED INDEX UX_TaskTypes_Name_Active
        ON dbo.TaskTypes (WorkspaceId, NameSingular)
        WHERE DeletedAt IS NULL;
GO
