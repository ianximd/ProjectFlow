CREATE OR ALTER PROCEDURE dbo.usp_TaskCustomField_RecomputeProgressAuto
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ListPath NVARCHAR(900), @WorkspaceId UNIQUEIDENTIFIER, @Total INT, @Done INT, @Pct INT;
    SELECT @ListPath = ListPath, @WorkspaceId = WorkspaceId FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL;
    IF @ListPath IS NULL RETURN;

    SELECT @Total = COUNT(*),
           @Done  = SUM(CASE WHEN ResolvedAt IS NOT NULL THEN 1 ELSE 0 END)
    FROM dbo.Tasks WHERE ParentTaskId = @TaskId AND DeletedAt IS NULL;

    SET @Pct = CASE WHEN ISNULL(@Total, 0) = 0 THEN 0 ELSE CAST(ROUND(100.0 * @Done / @Total, 0) AS INT) END;

    MERGE dbo.TaskCustomFieldValues AS tgt
    USING (
        SELECT cf.Id AS FieldId
        FROM   dbo.CustomFields cf
        WHERE  cf.WorkspaceId = @WorkspaceId AND cf.DeletedAt IS NULL
          AND  cf.Type = 'progress_auto' AND @ListPath LIKE cf.ScopePath + '%'
    ) AS src
    ON  tgt.TaskId = @TaskId AND tgt.FieldId = src.FieldId
    WHEN MATCHED THEN UPDATE SET Value = CONVERT(NVARCHAR(MAX), @Pct), UpdatedAt = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (TaskId, FieldId, Value) VALUES (@TaskId, src.FieldId, CONVERT(NVARCHAR(MAX), @Pct));
END;
