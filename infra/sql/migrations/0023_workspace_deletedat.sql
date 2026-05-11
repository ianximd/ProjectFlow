-- =============================================================================
-- Migration 0023: Workspaces.DeletedAt (soft-delete column)
-- =============================================================================
-- usp_Workspace_Delete tried to physically delete the Workspaces row, but
-- multiple tables (Projects, Sprints, Tasks, WorkflowDefinitions, UserRoles)
-- still hold REFERENCES Workspaces(Id) without ON DELETE CASCADE, so the
-- statement fails with a foreign-key error → API returns 500.
--
-- We follow the same pattern Users and Projects already use: keep the row,
-- stamp a DeletedAt timestamp, and filter it out of list/lookup queries.
-- =============================================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('dbo.Workspaces') AND name = 'DeletedAt'
)
BEGIN
    ALTER TABLE dbo.Workspaces ADD DeletedAt DATETIME2 NULL;
END
GO

-- Index to make "list active workspaces" cheap. Filtered so it stays small.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE  name = 'IX_Workspaces_DeletedAt' AND object_id = OBJECT_ID('dbo.Workspaces')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Workspaces_DeletedAt
      ON dbo.Workspaces (DeletedAt)
      WHERE DeletedAt IS NULL;
END
GO
