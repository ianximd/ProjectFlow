CREATE OR ALTER PROCEDURE usp_WorkspaceMember_Add
    @WorkspaceId UNIQUEIDENTIFIER,
    @UserId      UNIQUEIDENTIFIER,
    @Role        NVARCHAR(20) = 'MEMBER'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF EXISTS (SELECT 1 FROM WorkspaceMembers WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId)
            THROW 50011, 'User is already a member of this workspace.', 1;

        DECLARE @NewId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO WorkspaceMembers (Id, WorkspaceId, UserId)
        VALUES (@NewId, @WorkspaceId, @UserId);

        -- Map the @Role parameter (still in the API contract) to a workspace
        -- role slug and grant it via dbo.UserRoles. The legacy Role column on
        -- WorkspaceMembers was dropped in migration 0020.
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
        IF @RoleId IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM dbo.UserRoles
                WHERE UserId = @UserId AND RoleId = @RoleId AND WorkspaceId = @WorkspaceId
            )
        BEGIN
            INSERT INTO dbo.UserRoles (UserId, RoleId, WorkspaceId)
            VALUES (@UserId, @RoleId, @WorkspaceId);
        END

        -- Explicit column list (replaces SELECT * after the Role column was
        -- dropped in migration 0020). RoleSlug is returned so the API caller
        -- still has the effective role string without re-querying UserRoles.
        SELECT
            wm.Id,
            wm.WorkspaceId,
            wm.UserId,
            wm.JoinedAt,
            @RoleSlug AS RoleSlug
        FROM dbo.WorkspaceMembers wm
        WHERE wm.Id = @NewId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
