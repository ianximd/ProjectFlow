CREATE OR ALTER PROCEDURE dbo.usp_Permission_List
  @Scope NVARCHAR(16) = NULL  -- 'SYSTEM' | 'WORKSPACE' | NULL = both
AS
BEGIN
  SET NOCOUNT ON;

  SELECT Id, Resource, Action, Slug, Scope, Description, CreatedAt
  FROM dbo.Permissions
  WHERE @Scope IS NULL OR Scope = @Scope
  ORDER BY Scope, Resource, Action;
END;
