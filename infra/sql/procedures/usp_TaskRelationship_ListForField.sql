CREATE OR ALTER PROCEDURE usp_TaskRelationship_ListForField
    @FieldId UNIQUEIDENTIFIER, @FromTaskId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- The "value" of a relationship field on @FromTaskId is its set of ToTasks.
    SELECT t.Id AS TaskId, t.Title, t.Status, t.IssueKey
      FROM dbo.TaskRelationships r
      JOIN dbo.Tasks t ON t.Id = r.ToTaskId
     WHERE r.FieldId = @FieldId AND r.FromTaskId = @FromTaskId
       AND t.DeletedAt IS NULL
     ORDER BY t.Title;
END;
