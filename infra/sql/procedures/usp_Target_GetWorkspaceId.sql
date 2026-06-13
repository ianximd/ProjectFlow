-- Phase 8e: resolve a target's WorkspaceId (via its goal) for RBAC resolveWorkspace
-- (0 rows when missing or the goal is deleted). Added by the Batch-4 security review
-- (I3): target PATCH/DELETE act on targetId but were gated on the goalId in the URL,
-- which the SP never enforces (usp_Target_Update/_Delete filter by Id only) — a
-- mismatched-parent cross-tenant write. Gate on the TARGET's real workspace instead.
CREATE OR ALTER PROCEDURE dbo.usp_Target_GetWorkspaceId
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        SELECT g.WorkspaceId
        FROM dbo.Targets t
        JOIN dbo.Goals g ON g.Id = t.GoalId
        WHERE t.Id = @Id AND g.DeletedAt IS NULL;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
