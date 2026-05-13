-- Admin-only: change the operational Status of a workspace
-- (Phase 6 W43 — workspace status enum).
--
-- Status is orthogonal to DeletedAt — flipping it to FROZEN or
-- SUSPENDED does NOT soft-delete the workspace and does not cascade to
-- projects/tasks. The CHECK constraint in migration 0027 enforces the
-- allowed enum values; an invalid @Status raises error 547 and the
-- caller gets a 500 (the route handler should validate first).
--
-- Returns the updated row so the API can echo back the new state.
CREATE OR ALTER PROCEDURE dbo.usp_Workspace_SetStatus
    @Id     UNIQUEIDENTIFIER,
    @Status NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Workspaces
    SET    Status    = @Status,
           UpdatedAt = SYSUTCDATETIME()
    WHERE  Id = @Id;

    -- Return the row (Workspace_GetById filters soft-deleted; do an
    -- explicit SELECT here so we still echo back archived workspaces
    -- whose status the admin can also adjust).
    SELECT *
    FROM   dbo.Workspaces
    WHERE  Id = @Id;
END;
GO
