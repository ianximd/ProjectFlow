CREATE OR ALTER PROCEDURE dbo.usp_AccessRequest_GetById
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  -- Non-mutating read used for the authorize-THEN-mutate resolve flow: the
  -- service reads the request's (ObjectType, ObjectId) to assert FULL on the
  -- object BEFORE marking the request granted/denied or writing any grant.
  SELECT Id, WorkspaceId, ObjectType, ObjectId, RequestedBy, Note, Status, ResolvedBy, ResolvedAt, CreatedAt
  FROM dbo.AccessRequests WHERE Id = @Id;
END;
GO
