CREATE OR ALTER PROCEDURE dbo.usp_Role_GetBySlug
  @Slug NVARCHAR(100)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT Id, Name, Slug, Description, Scope, IsSystem, CreatedAt, UpdatedAt
  FROM dbo.Roles
  WHERE Slug = @Slug;
END;
