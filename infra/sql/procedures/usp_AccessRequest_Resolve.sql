CREATE OR ALTER PROCEDURE dbo.usp_AccessRequest_Resolve
  @Id         UNIQUEIDENTIFIER,
  @Status     NVARCHAR(12),   -- 'granted' | 'denied'
  @ResolvedBy UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- Only a still-pending request transitions (idempotent re-resolve is a no-op).
  UPDATE dbo.AccessRequests
  SET Status = @Status, ResolvedBy = @ResolvedBy, ResolvedAt = SYSUTCDATETIME()
  WHERE Id = @Id AND Status = 'pending';

  SELECT Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status, ResolvedBy, ResolvedAt, CreatedAt
  FROM dbo.AccessRequests WHERE Id = @Id;
END;
GO
