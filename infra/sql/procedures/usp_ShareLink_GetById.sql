CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_GetById
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- Non-mutating read used for the authorize-THEN-mutate revoke flow: the
  -- service reads the link's (ObjectType, ObjectId) to assert FULL before
  -- revoking. Returns the row regardless of revoked/expired state.
  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks WHERE Id = @Id;
END;
GO
