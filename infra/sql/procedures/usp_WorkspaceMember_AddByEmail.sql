-- Invite-existing-user flow: caller passes an email instead of a UserId so
-- the workspace owner doesn't need to know the invitee's internal id. If the
-- email doesn't resolve to an active user we throw a friendly 51052 ("user
-- not found — ask them to register first") rather than silently no-oping.
--
-- Idempotent on already-being-a-member: returns the existing membership row
-- without touching it. New members get the requested role slug via UserRoles.
CREATE OR ALTER PROCEDURE dbo.usp_WorkspaceMember_AddByEmail
    @WorkspaceId UNIQUEIDENTIFIER,
    @Email       NVARCHAR(255),
    @Role        NVARCHAR(20) = 'MEMBER'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @UserId UNIQUEIDENTIFIER;
    SELECT @UserId = Id FROM dbo.Users
    WHERE  Email = @Email AND DeletedAt IS NULL;

    IF @UserId IS NULL
        THROW 51052, 'No active user with that email. Ask them to register first.', 1;

    -- Map @Role string to a workspace role slug, same mapping as
    -- usp_WorkspaceMember_Add.
    DECLARE @RoleSlug NVARCHAR(100) =
        CASE UPPER(LTRIM(RTRIM(@Role)))
            WHEN 'OWNER'  THEN 'workspace-owner'
            WHEN 'ADMIN'  THEN 'workspace-admin'
            WHEN 'MEMBER' THEN 'workspace-member'
            WHEN 'VIEWER' THEN 'workspace-viewer'
            ELSE 'workspace-member'
        END;

    DECLARE @RoleId UNIQUEIDENTIFIER;
    SELECT @RoleId = Id FROM dbo.Roles WHERE Slug = @RoleSlug;

    BEGIN TRANSACTION;
    BEGIN TRY
        IF NOT EXISTS (
            SELECT 1 FROM dbo.WorkspaceMembers
            WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId
        )
        BEGIN
            INSERT INTO dbo.WorkspaceMembers (Id, WorkspaceId, UserId)
            VALUES (NEWID(), @WorkspaceId, @UserId);
        END

        IF @RoleId IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM dbo.UserRoles
                WHERE UserId = @UserId AND RoleId = @RoleId AND WorkspaceId = @WorkspaceId
            )
        BEGIN
            INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId)
            VALUES (@UserId, @RoleId, @WorkspaceId);
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    -- Echo back the resulting membership row so the UI can append it to the
    -- table without a refetch.
    SELECT u.Id        AS UserId,
           u.Email,
           u.Name,
           u.AvatarUrl,
           wm.JoinedAt,
           @RoleSlug   AS RoleSlugs,
           CAST(0 AS BIT) AS IsOwner
    FROM   dbo.WorkspaceMembers wm
    JOIN   dbo.Users            u ON u.Id = wm.UserId
    WHERE  wm.WorkspaceId = @WorkspaceId AND wm.UserId = @UserId;
END;
