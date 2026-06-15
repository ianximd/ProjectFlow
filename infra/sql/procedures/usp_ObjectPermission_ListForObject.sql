CREATE OR ALTER PROCEDURE dbo.usp_ObjectPermission_ListForObject
    @ObjectType NVARCHAR(8),     -- 'SPACE' | 'FOLDER' | 'LIST'
    @ObjectId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @SpaceId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER, @Path NVARCHAR(900);
    IF @ObjectType = 'SPACE'
        SELECT @SpaceId = Id, @WorkspaceId = WorkspaceId, @Path = '/' + CONVERT(NVARCHAR(36), Id) + '/'
        FROM dbo.Projects WHERE Id = @ObjectId AND Status <> 'DELETED';
    ELSE IF @ObjectType = 'FOLDER'
        SELECT @SpaceId = SpaceId, @WorkspaceId = WorkspaceId, @Path = Path
        FROM dbo.Folders WHERE Id = @ObjectId AND DeletedAt IS NULL;
    ELSE IF @ObjectType = 'LIST'
        SELECT @SpaceId = SpaceId, @WorkspaceId = WorkspaceId, @Path = Path
        FROM dbo.Lists WHERE Id = @ObjectId AND DeletedAt IS NULL;

    IF @SpaceId IS NULL
    BEGIN
        SELECT TOP 0
            CAST(NULL AS UNIQUEIDENTIFIER) AS Id, CAST(NULL AS NVARCHAR(8)) AS SubjectType,
            CAST(NULL AS UNIQUEIDENTIFIER) AS SubjectId, CAST(NULL AS NVARCHAR(255)) AS SubjectName,
            CAST(NULL AS NVARCHAR(320)) AS SubjectEmail, CAST(NULL AS NVARCHAR(8)) AS ObjectType,
            CAST(NULL AS UNIQUEIDENTIFIER) AS ObjectId, CAST(NULL AS NVARCHAR(8)) AS Level,
            CAST(0 AS BIT) AS Inherited, CAST(NULL AS NVARCHAR(255)) AS InheritedFromName;
        RETURN;
    END

    -- Ancestry: the Space (depth 0), ancestor folders (path is a prefix of @Path),
    -- and the object itself (depth 9999). Mirrors usp_ObjectAccess_Resolve.
    DECLARE @Ancestry TABLE (ObjectType NVARCHAR(8), ObjectId UNIQUEIDENTIFIER, Depth INT, Name NVARCHAR(255));
    INSERT INTO @Ancestry
        SELECT 'SPACE', p.Id, 0, p.Name FROM dbo.Projects p WHERE p.Id = @SpaceId;
    INSERT INTO @Ancestry
        SELECT 'FOLDER', f.Id, LEN(f.Path), f.Name
        FROM dbo.Folders f
        WHERE f.SpaceId = @SpaceId AND f.DeletedAt IS NULL AND @Path LIKE f.Path + '%';
    IF @ObjectType = 'LIST'
        INSERT INTO @Ancestry SELECT 'LIST', l.Id, 9999, l.Name FROM dbo.Lists l WHERE l.Id = @ObjectId;

    SELECT
        op.Id,
        op.SubjectType,
        op.SubjectId,
        CASE op.SubjectType WHEN 'USER' THEN u.Name ELSE r.Name END AS SubjectName,
        CASE op.SubjectType WHEN 'USER' THEN u.Email ELSE NULL    END AS SubjectEmail,
        op.ObjectType,
        op.ObjectId,
        op.Level,
        CAST(CASE WHEN op.ObjectType = @ObjectType AND op.ObjectId = @ObjectId THEN 0 ELSE 1 END AS BIT) AS Inherited,
        CASE WHEN op.ObjectType = @ObjectType AND op.ObjectId = @ObjectId THEN NULL ELSE a.Name END        AS InheritedFromName
    FROM dbo.ObjectPermissions op
    JOIN @Ancestry a ON a.ObjectType = op.ObjectType AND a.ObjectId = op.ObjectId
    LEFT JOIN dbo.Users u ON op.SubjectType = 'USER' AND u.Id = op.SubjectId
    LEFT JOIN dbo.Roles r ON op.SubjectType = 'ROLE' AND r.Id = op.SubjectId
    WHERE op.WorkspaceId = @WorkspaceId
    ORDER BY a.Depth DESC, op.SubjectType, SubjectName;
END;
