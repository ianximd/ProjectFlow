CREATE OR ALTER PROCEDURE usp_Task_Create
    @ProjectId    UNIQUEIDENTIFIER,
    @WorkspaceId  UNIQUEIDENTIFIER,
    @Title        NVARCHAR(500),
    @Description  NVARCHAR(MAX)    = NULL,
    @Type         NVARCHAR(20)     = 'TASK',
    @Status       NVARCHAR(100)    = 'To Do',
    @Priority     NVARCHAR(20)     = 'MEDIUM',
    @ReporterId   UNIQUEIDENTIFIER,
    @SprintId     UNIQUEIDENTIFIER = NULL,
    @EpicId       UNIQUEIDENTIFIER = NULL,
    @ParentTaskId UNIQUEIDENTIFIER = NULL,
    @StoryPoints  FLOAT            = NULL,
    -- Migration 0024 widened Tasks.DueDate from DATE to DATETIME2 so the
    -- board can set a time-of-day deadline. Param type follows suit.
    @DueDate      DATETIME2        = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Generate next issue key (e.g. PROJ-43)
        DECLARE @ProjectKey NVARCHAR(20);
        DECLARE @NextNum    INT;
        SELECT @ProjectKey = [Key] FROM Projects WHERE Id = @ProjectId;

        SELECT @NextNum = ISNULL(MAX(CAST(
            SUBSTRING(IssueKey, LEN(@ProjectKey)+2, 20) AS INT
        )), 0) + 1
        FROM Tasks WHERE ProjectId = @ProjectId;

        DECLARE @IssueKey    NVARCHAR(30) = @ProjectKey + '-' + CAST(@NextNum AS NVARCHAR);
        DECLARE @NewId       UNIQUEIDENTIFIER = NEWID();
        DECLARE @MaxPosition FLOAT;

        SELECT @MaxPosition = ISNULL(MAX(Position), 0)
        FROM Tasks WHERE ProjectId = @ProjectId AND DeletedAt IS NULL;

        INSERT INTO Tasks (
            Id, ProjectId, WorkspaceId, IssueKey, Title, Description,
            Type, Status, Priority, ReporterId, SprintId, EpicId,
            ParentTaskId, StoryPoints, DueDate, Position
        ) VALUES (
            @NewId, @ProjectId, @WorkspaceId, @IssueKey, @Title, @Description,
            @Type, @Status, @Priority, @ReporterId, @SprintId, @EpicId,
            @ParentTaskId, @StoryPoints, @DueDate, @MaxPosition + 1000
        );

        SELECT * FROM Tasks WHERE Id = @NewId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
