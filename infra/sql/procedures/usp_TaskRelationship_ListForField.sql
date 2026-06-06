CREATE OR ALTER PROCEDURE usp_TaskRelationship_ListForField
    @FieldId UNIQUEIDENTIFIER, @FromTaskId UNIQUEIDENTIFIER, @WorkspaceId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    -- The "value" of a relationship field on @FromTaskId is its set of ToTasks.
    -- Workspace-scoped (defense-in-depth, mirrors usp_TaskRelationship_Add).
    -- Capped at TOP (500): >500 linked tasks per field is unsupported for
    -- rollup v1 (also bounds the per-rollup fan-out read).
    SELECT TOP (500) t.Id AS TaskId, t.Title, t.Status, t.IssueKey
      FROM dbo.TaskRelationships r
      JOIN dbo.Tasks t ON t.Id = r.ToTaskId
     WHERE r.FieldId = @FieldId AND r.FromTaskId = @FromTaskId
       AND r.WorkspaceId = @WorkspaceId
       AND t.DeletedAt IS NULL
     ORDER BY t.Title;
END;
