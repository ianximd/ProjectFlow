CREATE OR ALTER PROCEDURE dbo.usp_AccessRequest_Resolve
  @Id         UNIQUEIDENTIFIER,
  @Status     NVARCHAR(12),   -- 'granted' | 'denied'
  @ResolvedBy UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- Only a still-pending request transitions.
  UPDATE dbo.AccessRequests
  SET Status = @Status, ResolvedBy = @ResolvedBy, ResolvedAt = SYSUTCDATETIME()
  WHERE Id = @Id AND Status = 'pending';

  -- Return the row ONLY if THIS call transitioned it. A re-resolve of an
  -- already-resolved request affects 0 rows -> empty result -> the service sees
  -- null and never (re)writes a grant. This prevents a denied request from being
  -- flipped to 'granted' via a stale id (the SP is the authoritative guard).
  IF @@ROWCOUNT = 0 RETURN;

  SELECT Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status, ResolvedBy, ResolvedAt, CreatedAt
  FROM dbo.AccessRequests WHERE Id = @Id;
END;
GO
