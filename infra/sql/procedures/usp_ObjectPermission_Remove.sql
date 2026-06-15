CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_Remove
    @SubjectType NVARCHAR(8),
    @SubjectId   UNIQUEIDENTIFIER,
    @ObjectType  NVARCHAR(8),
    @ObjectId    UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- Sibling of usp_ObjectPermission_Unset that returns the affected-row count
    -- so the service can decide "was anything actually revoked?" (audit + 404).
    DELETE FROM dbo.ObjectPermissions
    WHERE SubjectType = @SubjectType AND SubjectId = @SubjectId
      AND ObjectType = @ObjectType AND ObjectId = @ObjectId;
    SELECT @@ROWCOUNT AS Deleted;
END;
