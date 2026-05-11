-- Soft-delete a workspace. Physical delete is impossible without breaking
-- foreign keys (Projects / Sprints / Tasks / Workflows / UserRoles all
-- REFERENCES Workspaces without ON DELETE CASCADE), so we follow the same
-- pattern Users + Projects use: stamp DeletedAt and cascade soft-delete to
-- the child rows that have a status concept.
--
-- Restore is achieved by clearing DeletedAt (no separate restore SP — the
-- /workspaces PATCH route already supports field updates).
CREATE OR ALTER PROCEDURE dbo.usp_Workspace_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Workspaces WHERE Id = @Id AND DeletedAt IS NULL)
        THROW 51060, 'Workspace not found.', 1;

    BEGIN TRANSACTION;
    BEGIN TRY
        -- Soft-delete the workspace itself.
        UPDATE dbo.Workspaces
        SET    DeletedAt = SYSUTCDATETIME(),
               UpdatedAt = SYSUTCDATETIME()
        WHERE  Id = @Id;

        -- Cascade soft-delete to projects (so their boards/reports vanish from
        -- the switchers too). Tasks/sprints inherit their visibility from the
        -- project + workspace soft-delete filters in their list SPs.
        UPDATE dbo.Projects
        SET    Status    = 'DELETED',
               UpdatedAt = SYSUTCDATETIME()
        WHERE  WorkspaceId = @Id
          AND  Status <> 'DELETED';

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
