-- Replace the workspace-scoped role(s) for a user with a single new slug.
-- Called when a workspace owner changes a member from "Member" to "Admin"
-- and similar transitions. Does NOT touch system-scoped role assignments.
--
-- Refuses to demote the workspace owner — owners keep the 'workspace-owner'
-- slug for as long as they own the workspace; a separate ownership-transfer
-- flow would clear it.
CREATE OR ALTER PROCEDURE dbo.usp_WorkspaceMember_SetRole
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER,
    @Role        NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.WorkspaceMembers
        WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId
    )
        THROW 51050, 'User is not a member of this workspace.', 1;

    IF EXISTS (
        SELECT 1 FROM dbo.Workspaces
        WHERE Id = @WorkspaceId AND OwnerId = @UserId
    )
        THROW 51053, 'Cannot change the workspace owner''s role. Transfer ownership first.', 1;

    DECLARE @RoleSlug NVARCHAR(100) =
        CASE UPPER(LTRIM(RTRIM(@Role)))
            WHEN 'OWNER'  THEN 'workspace-owner'
            WHEN 'ADMIN'  THEN 'workspace-admin'
            WHEN 'MEMBER' THEN 'workspace-member'
            WHEN 'VIEWER' THEN 'workspace-viewer'
            ELSE NULL
        END;

    IF @RoleSlug IS NULL
        THROW 51054, 'Unknown role. Expected one of: ADMIN, MEMBER, VIEWER.', 1;

    DECLARE @RoleId UNIQUEIDENTIFIER;
    SELECT @RoleId = Id FROM dbo.Roles WHERE Slug = @RoleSlug;
    IF @RoleId IS NULL
        THROW 51055, 'Role slug does not exist in dbo.Roles.', 1;

    BEGIN TRANSACTION;
    BEGIN TRY
        -- Wipe any prior workspace-scoped role rows for this user in this
        -- workspace, then grant the new one. Cheaper than diffing.
        DELETE FROM dbo.UserRoles
        WHERE  UserId = @UserId AND WorkspaceId = @WorkspaceId;

        INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId)
        VALUES (@UserId, @RoleId, @WorkspaceId);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @UserId AS UserId, @RoleSlug AS RoleSlug;
END;
