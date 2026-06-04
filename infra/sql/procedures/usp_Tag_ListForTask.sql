CREATE OR ALTER PROCEDURE dbo.usp_Tag_ListForTask
    @TaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.* FROM dbo.Labels l
    JOIN dbo.TaskLabelLinks tl ON tl.LabelId = l.Id
    WHERE tl.TaskId = @TaskId
    ORDER BY l.Name;
END;
