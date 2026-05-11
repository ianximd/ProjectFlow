-- Members of a workspace, with display info AND the workspace-scoped role
-- slug(s) for each user. Roles come from dbo.UserRoles filtered to the same
-- workspace; STRING_AGG rolls multiple roles into a CSV (members usually
-- only have one workspace role but the schema doesn't enforce that).
CREATE OR ALTER PROCEDURE dbo.usp_Workspace_ListMembers
    @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.Id,
           u.Email,
           u.Name,
           u.AvatarUrl,
           wm.JoinedAt,
           (
               SELECT STRING_AGG(r.Slug, ',')
               FROM   dbo.UserRoles ur
               JOIN   dbo.Roles     r ON r.Id = ur.RoleId
               WHERE  ur.UserId      = u.Id
                 AND  ur.WorkspaceId = @WorkspaceId
           ) AS RoleSlugs,
           CASE WHEN u.Id = w.OwnerId THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS IsOwner
    FROM   dbo.WorkspaceMembers wm
    JOIN   dbo.Users            u ON u.Id = wm.UserId
    JOIN   dbo.Workspaces       w ON w.Id = wm.WorkspaceId
    WHERE  wm.WorkspaceId = @WorkspaceId
      AND  u.DeletedAt IS NULL
    ORDER  BY u.Name;
END;
