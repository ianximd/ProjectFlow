CREATE OR ALTER PROCEDURE dbo.usp_GuestInvite_Create
  @WorkspaceId UNIQUEIDENTIFIER,
  @Email       NVARCHAR(255),
  @ObjectType  NVARCHAR(8),
  @ObjectId    UNIQUEIDENTIFIER,
  @Level       NVARCHAR(8),
  @Token       NVARCHAR(64),
  @InvitedBy   UNIQUEIDENTIFIER,
  @ExpiresAt   DATETIME2 = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  INSERT INTO dbo.GuestInvites (Id, WorkspaceId, Email, ObjectType, ObjectId, Level, Token, Status, InvitedBy, ExpiresAt)
  VALUES (@NewId, @WorkspaceId, LOWER(LTRIM(RTRIM(@Email))), @ObjectType, @ObjectId, @Level, @Token, 'pending', @InvitedBy, @ExpiresAt);

  SELECT Id, WorkspaceId, Email, ObjectType, ObjectId, Level, Token, Status, InvitedBy, ExpiresAt, CreatedAt, AcceptedAt
  FROM dbo.GuestInvites WHERE Id = @NewId;
END;
GO
