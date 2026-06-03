CREATE OR ALTER PROCEDURE dbo.usp_Hierarchy_DescendantTasks
    @NodeType NVARCHAR(8),       -- 'SPACE' | 'FOLDER' | 'LIST'
    @NodeId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Prefix NVARCHAR(900);
    IF @NodeType = 'SPACE'
        SET @Prefix = '/' + CONVERT(NVARCHAR(36), @NodeId) + '/';
    ELSE IF @NodeType = 'FOLDER'
        SELECT @Prefix = Path FROM dbo.Folders WHERE Id = @NodeId AND DeletedAt IS NULL;
    ELSE IF @NodeType = 'LIST'
        SELECT @Prefix = Path FROM dbo.Lists WHERE Id = @NodeId AND DeletedAt IS NULL;

    IF @Prefix IS NULL THROW 51220, 'Node not found', 1;

    SELECT t.*
    FROM   dbo.Tasks t
    WHERE  t.ListPath LIKE @Prefix + '%'
      AND  t.DeletedAt IS NULL
    ORDER  BY t.ListPath, t.Position;
END;
