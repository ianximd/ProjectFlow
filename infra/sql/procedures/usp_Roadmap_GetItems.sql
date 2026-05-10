CREATE OR ALTER PROCEDURE usp_Roadmap_GetItems
    @ProjectId   UNIQUEIDENTIFIER = NULL,
    @WorkspaceId UNIQUEIDENTIFIER = NULL,
    @FromDate    DATE             = NULL,
    @ToDate      DATE             = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @ProjectId IS NULL AND @WorkspaceId IS NULL
        THROW 50400, 'Either @ProjectId or @WorkspaceId is required', 1;

    -- Default range: 30 days back, 90 days forward
    IF @FromDate IS NULL SET @FromDate = CAST(DATEADD(DAY, -30, GETUTCDATE()) AS DATE);
    IF @ToDate   IS NULL SET @ToDate   = CAST(DATEADD(DAY,  90, GETUTCDATE()) AS DATE);

    -- Recordset 1: roadmap items
    SELECT
        t.Id,
        t.IssueKey,
        t.Title,
        t.Type,
        t.Status,
        t.Priority,
        t.StartDate,
        t.DueDate,
        t.EpicId,
        t.ParentTaskId,
        t.StoryPoints,
        t.ProjectId,
        p.Name AS ProjectName,
        p.[Key] AS ProjectKey,
        (
            SELECT u.Id, u.Name, u.AvatarUrl
            FROM   TaskAssignees ta
            JOIN   Users u ON u.Id = ta.UserId
            WHERE  ta.TaskId = t.Id
            FOR JSON PATH
        ) AS AssigneesJson,
        (
            SELECT COUNT(*)
            FROM   Tasks c
            WHERE  c.EpicId = t.Id AND c.DeletedAt IS NULL
        ) AS ChildCount,
        (
            SELECT COUNT(*)
            FROM   Tasks c
            WHERE  c.EpicId = t.Id AND c.DeletedAt IS NULL
              AND  c.Status  = 'Done'
        ) AS ChildDoneCount
    FROM  Tasks t
    JOIN  Projects p ON p.Id = t.ProjectId
    WHERE t.DeletedAt IS NULL
      AND (@ProjectId   IS NULL OR t.ProjectId   = @ProjectId)
      AND (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
      AND (
            -- Always include EPICs
            t.Type = 'EPIC'
            -- Include tasks that have at least one date and overlap the range
            OR (
                (t.StartDate IS NOT NULL OR t.DueDate IS NOT NULL)
                AND ISNULL(t.StartDate, t.DueDate) <= @ToDate
                AND ISNULL(t.DueDate,  t.StartDate) >= @FromDate
            )
          )
    ORDER BY
        CASE t.Type WHEN 'EPIC' THEN 0 ELSE 1 END,
        t.EpicId,
        ISNULL(t.StartDate, t.DueDate),
        t.IssueKey;

    -- Recordset 2: dependencies within the same scope
    SELECT
        d.TaskId,
        d.DependsOn,
        d.Type
    FROM  TaskDependencies d
    JOIN  Tasks t1 ON t1.Id = d.TaskId    AND t1.DeletedAt IS NULL
    JOIN  Tasks t2 ON t2.Id = d.DependsOn AND t2.DeletedAt IS NULL
    WHERE (@ProjectId   IS NULL OR t1.ProjectId   = @ProjectId)
      AND (@WorkspaceId IS NULL OR t1.WorkspaceId = @WorkspaceId);
END;
