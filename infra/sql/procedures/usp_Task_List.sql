CREATE OR ALTER PROCEDURE usp_Task_List
    @ProjectId  UNIQUEIDENTIFIER,
    @Status     NVARCHAR(100) = NULL,
    @AssigneeId UNIQUEIDENTIFIER = NULL,
    @SprintId   UNIQUEIDENTIFIER = NULL,
    @Priority   NVARCHAR(20) = NULL,
    @Page       INT = 1,
    @PageSize   INT = 25
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @Offset INT = (@Page - 1) * @PageSize;

    SELECT *
    FROM Tasks
    WHERE ProjectId = @ProjectId
      AND (@Status IS NULL OR Status = @Status)
      AND (@SprintId IS NULL OR SprintId = @SprintId)
      AND (@Priority IS NULL OR Priority = @Priority)
      AND DeletedAt IS NULL
      AND (@AssigneeId IS NULL OR Id IN (SELECT TaskId FROM TaskAssignees WHERE UserId = @AssigneeId))
    ORDER BY Position ASC
    OFFSET @Offset ROWS
    FETCH NEXT @PageSize ROWS ONLY;

    SELECT COUNT(*) AS Total
    FROM Tasks
    WHERE ProjectId = @ProjectId
      AND (@Status IS NULL OR Status = @Status)
      AND (@SprintId IS NULL OR SprintId = @SprintId)
      AND (@Priority IS NULL OR Priority = @Priority)
      AND DeletedAt IS NULL
      AND (@AssigneeId IS NULL OR Id IN (SELECT TaskId FROM TaskAssignees WHERE UserId = @AssigneeId));
END;
