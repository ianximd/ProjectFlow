CREATE OR ALTER PROCEDURE usp_Workspace_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    -- Remove members first to satisfy FK ordering (soft-delete workspace only)
    -- We keep workspace rows for audit; a hard-delete can be scheduled later.
    -- For now we mark a DeletedAt if the column exists, or simply block access via app layer.
    -- The current schema has no DeletedAt on Workspaces, so we physically delete.
    -- NOTE: cascade-delete dependent records (WorkspaceMembers, Projects) must be
    -- handled before calling this SP in production.

    DELETE FROM WorkspaceMembers WHERE WorkspaceId = @Id;

    -- Cascade: archive all active projects in the workspace
    UPDATE Projects
    SET    Status    = 'DELETED',
           UpdatedAt = GETUTCDATE()
    WHERE  WorkspaceId = @Id
      AND  Status <> 'DELETED';

    DELETE FROM Workspaces WHERE Id = @Id;
END;
