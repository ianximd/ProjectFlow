CREATE OR ALTER PROCEDURE dbo.usp_Role_List
  @Scope NVARCHAR(16) = NULL  -- 'SYSTEM' | 'WORKSPACE' | NULL = both
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    r.Id, r.Name, r.Slug, r.Description, r.Scope, r.IsSystem,
    r.CreatedAt, r.UpdatedAt,
    (SELECT COUNT(*) FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id) AS PermissionCount,
    (SELECT COUNT(*) FROM dbo.UserRoles      ur WHERE ur.RoleId = r.Id) AS MemberCount
  FROM dbo.Roles r
  WHERE @Scope IS NULL OR r.Scope = @Scope
  ORDER BY r.IsSystem DESC, r.Scope, r.Name;
END;
