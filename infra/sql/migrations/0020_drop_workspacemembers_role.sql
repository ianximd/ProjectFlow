-- =============================================================================
-- Migration 0020: drop the legacy WorkspaceMembers.Role column
-- =============================================================================
-- Since migration 0018 introduced dbo.UserRoles with proper workspace-scoped
-- role assignments, the free-text WorkspaceMembers.Role column has no readers
-- (audited Week 31 — neither SP nor application code consumes it). Migration
-- 0018 already backfilled every existing WorkspaceMembers row into UserRoles,
-- and the bridge logic in usp_Workspace_Create / usp_WorkspaceMember_Add
-- (added Week 27) keeps newly inserted members in sync.
--
-- Idempotent: only attempts the drop if the column still exists.
-- =============================================================================

IF EXISTS (
    SELECT 1
    FROM   sys.columns
    WHERE  object_id = OBJECT_ID('dbo.WorkspaceMembers')
      AND  name      = 'Role'
)
BEGIN
    -- 1. Drop the covering index added by migration 0016, which has Role as
    --    an INCLUDE column. The DROP COLUMN at the bottom would otherwise
    --    fail with error 4922 ("one or more objects access this column").
    --    The index is recreated below without Role in INCLUDE.
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE  name = 'IX_WorkspaceMember_WorkspaceId_UserId'
          AND  object_id = OBJECT_ID('dbo.WorkspaceMembers')
    )
        DROP INDEX IX_WorkspaceMember_WorkspaceId_UserId ON dbo.WorkspaceMembers;

    -- 2. Drop the auto-named DEFAULT 'MEMBER' constraint bound to the column.
    DECLARE @ConstraintName NVARCHAR(200);
    SELECT @ConstraintName = dc.name
    FROM   sys.default_constraints dc
    JOIN   sys.columns c
        ON c.default_object_id = dc.object_id
    WHERE  c.object_id = OBJECT_ID('dbo.WorkspaceMembers')
      AND  c.name      = 'Role';

    IF @ConstraintName IS NOT NULL
    BEGIN
        DECLARE @Sql NVARCHAR(400) =
            N'ALTER TABLE dbo.WorkspaceMembers DROP CONSTRAINT ' + QUOTENAME(@ConstraintName);
        EXEC sp_executesql @Sql;
    END

    -- 3. Now safe to drop the column.
    ALTER TABLE dbo.WorkspaceMembers DROP COLUMN Role;
END
GO


-- Recreate the covering index without Role in INCLUDE. Idempotent — only
-- creates if the table no longer has a Role column AND the index is missing.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('dbo.WorkspaceMembers') AND name = 'Role'
)
AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE  name = 'IX_WorkspaceMember_WorkspaceId_UserId'
      AND  object_id = OBJECT_ID('dbo.WorkspaceMembers')
)
    CREATE NONCLUSTERED INDEX IX_WorkspaceMember_WorkspaceId_UserId
      ON dbo.WorkspaceMembers (WorkspaceId, UserId)
      INCLUDE (JoinedAt)
      WITH (ONLINE = ON);
GO
