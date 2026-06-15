CREATE OR ALTER PROCEDURE dbo.usp_Role_GetBySlug
  @Slug NVARCHAR(100)
AS
BEGIN
  SET NOCOUNT ON;

  -- System/global roles only (WorkspaceId IS NULL). Post-0060 a workspace custom
  -- role may share a slug with a system role (slugs are unique only per-scope),
  -- so restrict to the globally-unique system slug to keep this lookup
  -- deterministic — every caller resolves system/global roles by slug.
  SELECT Id, Name, Slug, Description, Scope, IsSystem, WorkspaceId, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Slug = @Slug AND WorkspaceId IS NULL;
END;
