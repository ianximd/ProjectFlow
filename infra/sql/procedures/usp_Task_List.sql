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

    -- Materialise the filtered task ids once so we can both project them in
    -- result set 1 and join them in result set 3 (assignees) without
    -- duplicating the WHERE clause across three queries.
    DECLARE @PageIds TABLE (Id UNIQUEIDENTIFIER PRIMARY KEY);

    INSERT INTO @PageIds (Id)
    SELECT t.Id
    FROM   Tasks t
    WHERE  t.ProjectId = @ProjectId
      AND  (@Status   IS NULL OR t.Status   = @Status)
      AND  (@SprintId IS NULL OR t.SprintId = @SprintId)
      AND  (@Priority IS NULL OR t.Priority = @Priority)
      AND  t.DeletedAt IS NULL
      AND  (@AssigneeId IS NULL OR t.Id IN (SELECT TaskId FROM TaskAssignees WHERE UserId = @AssigneeId))
    ORDER  BY t.Position ASC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1 — the page of tasks in stable position order.
    SELECT t.*
    FROM   Tasks t
    JOIN   @PageIds p ON p.Id = t.Id
    ORDER  BY t.Position ASC;

    -- Result set 2 — total count for pagination (unfiltered by Page/PageSize).
    SELECT COUNT(*) AS Total
    FROM   Tasks
    WHERE  ProjectId = @ProjectId
      AND  (@Status   IS NULL OR Status   = @Status)
      AND  (@SprintId IS NULL OR SprintId = @SprintId)
      AND  (@Priority IS NULL OR Priority = @Priority)
      AND  DeletedAt IS NULL
      AND  (@AssigneeId IS NULL OR Id IN (SELECT TaskId FROM TaskAssignees WHERE UserId = @AssigneeId));

    -- Result set 3 — assignees for the page, joined to Users for display.
    -- Caller groups by TaskId to render avatar stacks. Returned even when
    -- empty so the caller can rely on a 3-recordset shape.
    SELECT ta.TaskId,
           u.Id        AS UserId,
           u.Email,
           u.Name,
           u.AvatarUrl
    FROM   dbo.TaskAssignees ta
    JOIN   dbo.Users         u ON u.Id = ta.UserId
    JOIN   @PageIds p          ON p.Id = ta.TaskId
    WHERE  u.DeletedAt IS NULL
    ORDER  BY ta.TaskId, u.Name;
END;
