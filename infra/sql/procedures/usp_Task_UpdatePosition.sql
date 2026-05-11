-- Set a task's Position (and optionally Status) without going through the
-- workflow transition validator. The board uses this on drag-end to persist
-- a drag-reorder; cross-column drags persist their NEW status here too so we
-- don't need two round-trips. The workflow transition SP is still the
-- canonical path for explicit status changes (drawer / keyboard).
CREATE OR ALTER PROCEDURE dbo.usp_Task_UpdatePosition
    @TaskId    UNIQUEIDENTIFIER,
    @Position  FLOAT,
    @NewStatus NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Tasks
    SET    Position  = @Position,
           Status    = COALESCE(@NewStatus, Status),
           UpdatedAt = SYSUTCDATETIME()
    WHERE  Id = @TaskId
      AND  DeletedAt IS NULL;

    SELECT Id, ProjectId, WorkspaceId, IssueKey, Status, Position, UpdatedAt
    FROM   dbo.Tasks
    WHERE  Id = @TaskId;
END;
