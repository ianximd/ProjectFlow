CREATE OR ALTER PROCEDURE dbo.usp_Tag_LinkTask
    @TaskId UNIQUEIDENTIFIER, @TagId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL) THROW 51341, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Labels WHERE Id = @TagId) THROW 51342, 'Tag not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskLabelLinks WHERE TaskId = @TaskId AND LabelId = @TagId)
            INSERT INTO dbo.TaskLabelLinks (TaskId, LabelId) VALUES (@TaskId, @TagId);
    END TRY BEGIN CATCH THROW; END CATCH
END;
