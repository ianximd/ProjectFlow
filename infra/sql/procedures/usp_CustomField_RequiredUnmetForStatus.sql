CREATE OR ALTER PROCEDURE dbo.usp_CustomField_RequiredUnmetForStatus
    @TaskId       UNIQUEIDENTIFIER,
    @TargetStatus NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ListId UNIQUEIDENTIFIER, @ListPath NVARCHAR(900),
            @ProjectId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER, @wf UNIQUEIDENTIFIER, @IsDone BIT = 0;

    SELECT @ListId = ListId, @ListPath = ListPath, @ProjectId = ProjectId, @WorkspaceId = WorkspaceId
    FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;

    IF @ListId IS NOT NULL
        SELECT @wf = COALESCE(l.WorkflowId, f.WorkflowId, p.WorkflowId)
        FROM dbo.Lists l LEFT JOIN dbo.Folders f ON f.Id = l.FolderId
             JOIN dbo.Projects p ON p.Id = l.SpaceId
        WHERE l.Id = @ListId AND l.DeletedAt IS NULL;
    ELSE
        SELECT @wf = WorkflowId FROM dbo.Projects WHERE Id = @ProjectId;

    IF @wf IS NOT NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.WorkflowStatuses
                   WHERE WorkflowId = @wf AND Name = @TargetStatus AND Category = 'DONE')
            SET @IsDone = 1;
    END
    ELSE IF @TargetStatus IN ('Done', 'Resolved', 'Closed', 'Completed')
        SET @IsDone = 1;

    IF @IsDone = 0 OR @ListPath IS NULL
    BEGIN
        SELECT TOP 0 cf.* FROM dbo.CustomFields cf;   -- shape-compatible empty set
        RETURN;
    END

    SELECT cf.*
    FROM   dbo.CustomFields cf
    LEFT JOIN dbo.TaskCustomFieldValues v ON v.FieldId = cf.Id AND v.TaskId = @TaskId
    WHERE  cf.WorkspaceId = @WorkspaceId
      AND  cf.DeletedAt IS NULL
      AND  cf.Required = 1
      AND  @ListPath LIKE cf.ScopePath + '%'
      AND  (v.Value IS NULL OR v.Value = '' OR v.Value = 'null' OR v.Value = '""' OR v.Value = '[]')
    ORDER BY LEN(cf.ScopePath), cf.Position;
END;
