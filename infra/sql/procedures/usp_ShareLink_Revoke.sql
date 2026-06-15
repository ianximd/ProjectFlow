CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_Revoke
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- Soft-revoke by id. The service has already read the link + enforced FULL on
  -- the object before calling this (authorize-then-mutate).
  UPDATE dbo.ShareLinks SET RevokedAt = SYSUTCDATETIME()
  WHERE Id = @Id AND RevokedAt IS NULL;

  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks WHERE Id = @Id;
END;
GO
