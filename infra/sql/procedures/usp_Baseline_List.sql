CREATE OR ALTER PROCEDURE dbo.usp_Baseline_List
    @ViewId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, ViewId, Name, CapturedAt, CreatedBy
    FROM dbo.Baselines
    WHERE ViewId = @ViewId
    ORDER BY CapturedAt DESC;

    SELECT bt.BaselineId, bt.TaskId, bt.StartDate, bt.DueDate
    FROM dbo.BaselineTasks bt
    JOIN dbo.Baselines b ON b.Id = bt.BaselineId
    WHERE b.ViewId = @ViewId
    ORDER BY bt.BaselineId;
END;
GO
