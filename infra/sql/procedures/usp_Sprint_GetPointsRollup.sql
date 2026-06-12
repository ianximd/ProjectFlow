CREATE OR ALTER PROCEDURE dbo.usp_Sprint_GetPointsRollup
    @SprintId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ListId UNIQUEIDENTIFIER;
    SELECT @ListId = ListId FROM dbo.Sprints WHERE Id = @SprintId;

    -- Sprint membership = tasks in the sprint List (falling back to the SprintId
    -- denorm when the sprint is not yet List-bound, e.g. mid-migration).
    ;WITH SprintTasks AS (
        SELECT t.Id, t.StoryPoints,
               CASE WHEN t.ResolvedAt IS NOT NULL THEN 1 ELSE 0 END AS IsDone
        FROM   dbo.Tasks t
        WHERE  t.DeletedAt IS NULL
          AND  ( (@ListId IS NOT NULL AND t.ListId = @ListId) OR t.SprintId = @SprintId )
    )
    -- ResultSet 1: total
    SELECT
        ISNULL(SUM(ISNULL(StoryPoints,0)), 0) AS TotalPoints,
        ISNULL(SUM(CASE WHEN IsDone = 1 THEN ISNULL(StoryPoints,0) ELSE 0 END), 0) AS CompletedPoints
    FROM SprintTasks;

    -- ResultSet 2: per-assignee split via TaskAssignees.
    ;WITH SprintTasks AS (
        SELECT t.Id, t.StoryPoints
        FROM   dbo.Tasks t
        WHERE  t.DeletedAt IS NULL
          AND  ( (@ListId IS NOT NULL AND t.ListId = @ListId) OR t.SprintId = @SprintId )
    )
    SELECT
        ta.UserId,
        u.Name AS UserName,
        ISNULL(SUM(ISNULL(st.StoryPoints,0)), 0) AS Points
    FROM SprintTasks st
    JOIN dbo.TaskAssignees ta ON ta.TaskId = st.Id
    JOIN dbo.Users u ON u.Id = ta.UserId
    GROUP BY ta.UserId, u.Name
    ORDER BY Points DESC;
END;
GO
