CREATE OR ALTER PROCEDURE dbo.usp_TaskCustomFieldValue_Delete
    @TaskId  UNIQUEIDENTIFIER,
    @FieldId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.TaskCustomFieldValues WHERE TaskId = @TaskId AND FieldId = @FieldId;
END;
