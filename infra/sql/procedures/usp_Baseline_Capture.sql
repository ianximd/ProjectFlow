CREATE OR ALTER PROCEDURE dbo.usp_Baseline_Capture
    @ViewId    UNIQUEIDENTIFIER,
    @Name      NVARCHAR(200),
    @CreatedBy UNIQUEIDENTIFIER,
    @TaskIds   NVARCHAR(MAX) = NULL   -- comma-delimited GUID list of in-scope tasks
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.Baselines (Id, ViewId, Name, CreatedBy)
        VALUES (@Id, @ViewId, @Name, @CreatedBy);

        -- Freeze each in-scope task's CURRENT dates. STRING_SPLIT + TRY_CONVERT
        -- mirrors usp_WorkLogTag_Set; only existing, non-deleted tasks are frozen.
        IF @TaskIds IS NOT NULL AND LEN(@TaskIds) > 0
            INSERT INTO dbo.BaselineTasks (BaselineId, TaskId, StartDate, DueDate)
            SELECT @Id, t.Id, t.StartDate, t.DueDate
            FROM dbo.Tasks t
            JOIN (
                SELECT DISTINCT TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) AS TaskId
                FROM STRING_SPLIT(@TaskIds, ',')
                WHERE TRY_CONVERT(UNIQUEIDENTIFIER, LTRIM(RTRIM(value))) IS NOT NULL
            ) ids ON ids.TaskId = t.Id
            WHERE t.DeletedAt IS NULL;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT Id, ViewId, Name, CapturedAt, CreatedBy FROM dbo.Baselines WHERE Id = @Id;
END;
GO
