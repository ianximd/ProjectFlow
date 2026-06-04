CREATE OR ALTER PROCEDURE dbo.usp_Tag_LinkTask
    @TaskId UNIQUEIDENTIFIER, @TagId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE Id = @TaskId AND DeletedAt IS NULL) THROW 51341, 'Task not found', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.Labels WHERE Id = @TagId) THROW 51342, 'Tag not found', 1;
        -- Tenant guard (defense-in-depth): the tag (Label) is Space-scoped, so it
        -- must live in the same Space (Projects row) as the task. Blocks linking a
        -- tag from another workspace/space even if a caller bypasses the route ACL.
        IF NOT EXISTS (
            SELECT 1 FROM dbo.Tasks t
            JOIN dbo.Labels l ON l.ProjectId = t.ProjectId
            WHERE t.Id = @TaskId AND l.Id = @TagId
        )
            THROW 51343, 'Tag does not belong to the task''s space', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.TaskLabelLinks WHERE TaskId = @TaskId AND LabelId = @TagId)
            INSERT INTO dbo.TaskLabelLinks (TaskId, LabelId) VALUES (@TaskId, @TagId);
    END TRY BEGIN CATCH THROW; END CATCH
END;
