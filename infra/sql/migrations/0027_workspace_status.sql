-- =============================================================================
-- Migration 0027: Workspaces.Status (Phase 6 W43 — richer workspace status)
-- =============================================================================
-- Until now the admin "Status" column for a workspace was a binary
-- Active / Archived ternary computed from DeletedAt. That covered
-- soft-delete but couldn't express other states an operator cares about:
-- a workspace on a TRIAL plan, one FROZEN for non-payment, or one
-- SUSPENDED while a compliance issue is investigated.
--
-- This migration adds a `Status` enum column. It is INTENTIONALLY
-- orthogonal to DeletedAt:
--   - DeletedAt IS NOT NULL → "Archived" (existing soft-delete semantic;
--     wins in the admin badge regardless of Status)
--   - Status governs operational state for non-archived workspaces:
--     ACTIVE | TRIAL | FROZEN | SUSPENDED
--
-- This means flipping Status='FROZEN' does NOT soft-delete the workspace
-- and does not cascade to projects/tasks. Existing Workspace_Delete /
-- Workspace_Restore SPs continue to manage DeletedAt as before. Status
-- is purely an admin annotation that drives UI display + permission
-- decisions (e.g. a future hook can refuse writes when Status='FROZEN').
--
-- Idempotent.
-- =============================================================================

IF NOT EXISTS (
    SELECT 1
    FROM   sys.columns
    WHERE  object_id = OBJECT_ID('dbo.Workspaces')
       AND name      = 'Status'
)
BEGIN
    ALTER TABLE dbo.Workspaces
        ADD Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Workspaces_Status DEFAULT 'ACTIVE';
END
GO

-- CHECK constraint enforces the allowed enum values at the DB layer so
-- a buggy route handler can't write a garbage status. CHECK is also
-- self-documenting: an operator can `sp_help dbo.Workspaces` and see
-- the valid set.
IF NOT EXISTS (
    SELECT 1
    FROM   sys.check_constraints
    WHERE  name = 'CK_Workspaces_Status'
       AND parent_object_id = OBJECT_ID('dbo.Workspaces')
)
BEGIN
    ALTER TABLE dbo.Workspaces
        ADD CONSTRAINT CK_Workspaces_Status
            CHECK (Status IN ('ACTIVE', 'TRIAL', 'FROZEN', 'SUSPENDED'));
END
GO
