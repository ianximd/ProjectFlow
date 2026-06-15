CREATE OR ALTER PROCEDURE dbo.usp_ShareLink_Create
  @WorkspaceId UNIQUEIDENTIFIER,
  @ObjectType  NVARCHAR(16),
  @ObjectId    UNIQUEIDENTIFIER,
  @Token       NVARCHAR(64),
  @Level       NVARCHAR(8)      = 'VIEW',
  @ExpiresAt   DATETIME2        = NULL,
  @CreatedBy   UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

  BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO dbo.ShareLinks (Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy)
    VALUES (@NewId, @WorkspaceId, @ObjectType, @ObjectId, @Token, @Level, @ExpiresAt, @CreatedBy);

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT Id, WorkspaceId, ObjectType, ObjectId, Token, Level, ExpiresAt, CreatedBy, CreatedAt, RevokedAt
  FROM dbo.ShareLinks WHERE Id = @NewId;
END;
GO
