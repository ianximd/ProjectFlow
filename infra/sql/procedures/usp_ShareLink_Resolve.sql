CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_Resolve
  @Token NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  -- Live-only: never leak a revoked/expired link on the unauthenticated path.
  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks
  WHERE Token = @Token
    AND RevokedAt IS NULL
    AND (ExpiresAt IS NULL OR ExpiresAt > SYSUTCDATETIME());
END;
GO
