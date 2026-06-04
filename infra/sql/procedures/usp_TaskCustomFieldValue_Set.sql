CREATE OR ALTER PROCEDURE dbo.usp_TaskCustomFieldValue_Set
    @TaskId  UNIQUEIDENTIFIER,
    @FieldId UNIQUEIDENTIFIER,
    @Value   NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL)
            THROW 51302, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.CustomFields WHERE Id = @FieldId AND DeletedAt IS NULL)
            THROW 51300, 'Custom field not found', 1;
        -- Tenant guard (defense-in-depth): the field must belong to the same
        -- workspace as the task. Blocks cross-workspace value writes even if a
        -- caller bypasses the route/resolver ACL.
        IF NOT EXISTS (
            SELECT 1 FROM dbo.Tasks t
            JOIN dbo.CustomFields cf ON cf.WorkspaceId = t.WorkspaceId
            WHERE t.Id = @TaskId AND cf.Id = @FieldId
        )
            THROW 51303, 'Custom field does not belong to the task''s workspace', 1;

        MERGE dbo.TaskCustomFieldValues AS tgt
        USING (SELECT @TaskId AS TaskId, @FieldId AS FieldId) AS src
        ON  tgt.TaskId = src.TaskId AND tgt.FieldId = src.FieldId
        WHEN MATCHED THEN UPDATE SET Value = @Value, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (TaskId, FieldId, Value) VALUES (@TaskId, @FieldId, @Value);

        SELECT * FROM dbo.TaskCustomFieldValues WHERE TaskId = @TaskId AND FieldId = @FieldId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
