CREATE OR ALTER PROCEDURE dbo.usp_Workspace_ListOwnerAdminIds
  @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- Owner/admin recipient ids for an object's workspace — the Phase 3.5
  -- notification fan-out target for an access request. System role slugs only
  -- (WorkspaceId IS NULL on the role), scoped to this workspace's assignments.
  SELECT DISTINCT ur.UserId
  FROM dbo.UserRoles ur
  JOIN dbo.Roles r ON r.Id = ur.RoleId
  WHERE ur.WorkspaceId = @WorkspaceId
    AND r.WorkspaceId IS NULL
    AND r.Slug IN ('workspace-owner', 'workspace-admin');
END;
GO
