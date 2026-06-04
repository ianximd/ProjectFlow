CREATE OR ALTER PROCEDURE dbo.usp_CustomField_EffectiveForTask
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ListPath NVARCHAR(900), @WorkspaceId UNIQUEIDENTIFIER;
    SELECT @ListPath = ListPath, @WorkspaceId = WorkspaceId
    FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;

    IF @ListPath IS NULL
    BEGIN
        -- Task not in a list: no location-scoped fields apply. Return empty,
        -- shape-compatible result set.
        SELECT TOP 0 cf.*, CAST(NULL AS NVARCHAR(MAX)) AS CurrentValue
        FROM dbo.CustomFields cf;
        RETURN;
    END

    SELECT cf.*, v.Value AS CurrentValue
    FROM   dbo.CustomFields cf
    LEFT JOIN dbo.TaskCustomFieldValues v ON v.FieldId = cf.Id AND v.TaskId = @TaskId
    WHERE  cf.WorkspaceId = @WorkspaceId
      AND  cf.DeletedAt IS NULL
      AND  @ListPath LIKE cf.ScopePath + '%'
    ORDER  BY LEN(cf.ScopePath), cf.Position, cf.CreatedAt;
END;
