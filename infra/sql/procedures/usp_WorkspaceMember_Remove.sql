-- Remove a user from a workspace. Refuses to remove the workspace owner —
-- ownership transfer is a separate flow. Also wipes any workspace-scoped role
-- assignments so the user cleanly loses all access in this workspace.
--
-- Returns the deleted UserId so the caller can confirm success without a
-- follow-up GET.
CREATE OR ALTER PROCEDURE dbo.usp_WorkspaceMember_Remove
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER
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
        THROW 51051, 'Cannot remove the workspace owner. Transfer ownership first.', 1;

    BEGIN TRANSACTION;
    BEGIN TRY
        DELETE FROM dbo.UserRoles
        WHERE  UserId = @UserId AND WorkspaceId = @WorkspaceId;

        DELETE FROM dbo.WorkspaceMembers
        WHERE  WorkspaceId = @WorkspaceId AND UserId = @UserId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @UserId AS UserId, @WorkspaceId AS WorkspaceId;
END;
