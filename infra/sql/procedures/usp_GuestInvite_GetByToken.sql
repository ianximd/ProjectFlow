CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_GetByToken
  @Token NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT Id, WorkspaceId, Email, ObjectType, ObjectId, Level, Token, Status, InvitedBy, ExpiresAt, CreatedAt, AcceptedAt
  FROM dbo.GuestInvites WHERE Token = @Token;
END;
GO
