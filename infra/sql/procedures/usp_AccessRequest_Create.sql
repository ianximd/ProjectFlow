CREATE OR ALTER PROCEDURE dbo.usp_AccessRequest_Create
  @WorkspaceId UNIQUEIDENTIFIER,
  @ObjectType  NVARCHAR(16),
  @ObjectId    UNIQUEIDENTIFIER,
  @RequestedBy UNIQUEIDENTIFIER,
  @Note        NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Id UNIQUEIDENTIFIER;

  -- Idempotent under UQ_AccessRequests_Pending: a repeat request for the same
  -- (object, requester) while still pending returns the existing row.
  SELECT @Id = Id FROM dbo.AccessRequests
  WHERE ObjectType = @ObjectType AND ObjectId = @ObjectId
    AND RequestedBy = @RequestedBy AND Status = 'pending';

  IF @Id IS NULL
  BEGIN
    SET @Id = NEWID();
    BEGIN TRY
      BEGIN TRANSACTION;
      INSERT INTO dbo.AccessRequests (Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note)
      VALUES (@Id, @WorkspaceId, @ObjectType, @ObjectId, @RequestedBy, @Note);
      COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH;
  END

  SELECT Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status, ResolvedBy, ResolvedAt, CreatedAt
  FROM dbo.AccessRequests WHERE Id = @Id;
END;
GO
