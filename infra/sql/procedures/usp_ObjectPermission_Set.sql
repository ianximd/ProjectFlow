CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_Set
    @WorkspaceId UNIQUEIDENTIFIER,
    @SubjectType NVARCHAR(8),                 -- 'USER' | 'ROLE'
    @SubjectId   UNIQUEIDENTIFIER,
    @ObjectType  NVARCHAR(8),                 -- 'SPACE' | 'FOLDER' | 'LIST'
    @ObjectId    UNIQUEIDENTIFIER,
    @Level       NVARCHAR(8),                 -- 'VIEW' | 'COMMENT' | 'EDIT' | 'FULL'
    @GrantedBy   UNIQUEIDENTIFIER = NULL      -- audited at the service layer; column unchanged
AS
BEGIN
    SET NOCOUNT ON;

    IF @SubjectType NOT IN ('USER','ROLE')                  THROW 51010, 'SubjectType must be USER or ROLE', 1;
    IF @ObjectType  NOT IN ('SPACE','FOLDER','LIST')        THROW 51011, 'ObjectType must be SPACE, FOLDER or LIST', 1;
    IF @Level       NOT IN ('VIEW','COMMENT','EDIT','FULL')  THROW 51012, 'Level must be VIEW, COMMENT, EDIT or FULL', 1;

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
