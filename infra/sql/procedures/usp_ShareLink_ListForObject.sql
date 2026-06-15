CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_ListForObject
  @ObjectType NVARCHAR(16),
  @ObjectId   UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- Non-revoked links for the sharing modal.
  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks
  WHERE ObjectType = @ObjectType AND ObjectId = @ObjectId AND RevokedAt IS NULL
  ORDER BY CreatedAt DESC;
END;
GO
