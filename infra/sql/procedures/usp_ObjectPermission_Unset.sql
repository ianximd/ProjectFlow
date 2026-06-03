CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_Unset
    @SubjectType NVARCHAR(8),
    @SubjectId   UNIQUEIDENTIFIER,
    @ObjectType  NVARCHAR(8),
    @ObjectId    UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.ObjectPermissions
    WHERE SubjectType = @SubjectType AND SubjectId = @SubjectId AND ObjectType = @ObjectType AND ObjectId = @ObjectId;
END;
