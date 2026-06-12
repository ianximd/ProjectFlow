CREATE OR ALTER PROCEDURE dbo.usp_Sprint_ListDueFolders
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        f.Id            AS FolderId,
        f.WorkspaceId,
        f.SpaceId       AS ProjectId,
        ss.DurationDays,
        ss.StartDayOfWeek,
        ss.AutoStart,
        ss.AutoComplete,
        ss.AutoRollForward,
        ss.PointsFieldId,
        cur.Id          AS CurrentSprintId,
        cur.Status      AS CurrentSprintStatus,
        cur.StartDate   AS CurrentStartDate,
        cur.EndDate     AS CurrentEndDate
    FROM dbo.Folders f
    JOIN dbo.SprintSettings ss ON ss.FolderId = f.Id
    OUTER APPLY (
        SELECT TOP 1 s.Id, s.Status, s.StartDate, s.EndDate
        FROM   dbo.Sprints s
        WHERE  s.FolderId = f.Id AND s.Status <> 'COMPLETED'
        ORDER BY s.EndDate DESC, s.CreatedAt DESC
    ) cur
    WHERE f.IsSprintFolder = 1 AND f.DeletedAt IS NULL;
END;
GO
