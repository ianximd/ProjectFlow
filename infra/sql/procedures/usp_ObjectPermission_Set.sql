CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_Set
    @WorkspaceId UNIQUEIDENTIFIER,
    @SubjectType NVARCHAR(8),
    @SubjectId   UNIQUEIDENTIFIER,
    @ObjectType  NVARCHAR(8),
    @ObjectId    UNIQUEIDENTIFIER,
    @Level       NVARCHAR(8)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        MERGE dbo.ObjectPermissions AS tgt
        USING (SELECT @SubjectType AS S, @SubjectId AS SI, @ObjectType AS O, @ObjectId AS OI) AS src
        ON (tgt.SubjectType = src.S AND tgt.SubjectId = src.SI AND tgt.ObjectType = src.O AND tgt.ObjectId = src.OI)
        WHEN MATCHED THEN UPDATE SET Level = @Level
        WHEN NOT MATCHED THEN
            INSERT (WorkspaceId, SubjectType, SubjectId, ObjectType, ObjectId, Level)
            VALUES (@WorkspaceId, @SubjectType, @SubjectId, @ObjectType, @ObjectId, @Level);
        SELECT * FROM dbo.ObjectPermissions
        WHERE SubjectType = @SubjectType AND SubjectId = @SubjectId AND ObjectType = @ObjectType AND ObjectId = @ObjectId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
