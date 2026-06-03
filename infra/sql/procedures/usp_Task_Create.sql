CREATE OR ALTER PROCEDURE usp_Task_Create
    @ProjectId    UNIQUEIDENTIFIER = NULL,
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
    @DueDate      DATETIME2        = NULL,
    -- Migration 0029 (hierarchy): re-home the task into a List. When provided,
    -- the List's Space becomes the bridge ProjectId and ListPath is materialized.
    @ListId       UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- ── Hierarchy (0029): resolve List → derive Space, materialize ListPath ──
        DECLARE @ListPath NVARCHAR(900) = NULL;
        IF @ListId IS NOT NULL
        BEGIN
            DECLARE @ListSpaceId UNIQUEIDENTIFIER;
            SELECT @ListSpaceId = SpaceId, @ListPath = Path
            FROM   dbo.Lists WHERE Id = @ListId AND DeletedAt IS NULL;
            IF @ListSpaceId IS NULL THROW 51213, 'List not found', 1;
            SET @ProjectId = @ListSpaceId;   -- bridge: ProjectId tracks the List's Space
        END

        IF @ProjectId IS NULL
            THROW 51214, 'Either projectId or listId is required', 1;

        -- Subtask-depth guard (Space.MaxSubtaskDepth). Walk the ParentTaskId chain.
        IF @ParentTaskId IS NOT NULL
        BEGIN
            DECLARE @MaxDepth INT;
            SELECT @MaxDepth = MaxSubtaskDepth FROM dbo.Projects WHERE Id = @ProjectId;
            IF @MaxDepth IS NOT NULL
            BEGIN
                DECLARE @Depth INT = 1, @Cur UNIQUEIDENTIFIER = @ParentTaskId;
                WHILE @Cur IS NOT NULL
                BEGIN
                    SELECT @Cur = ParentTaskId FROM dbo.Tasks WHERE Id = @Cur;
                    SET @Depth = @Depth + 1;
                    IF @Depth > @MaxDepth + 1 BREAK;
                END
                IF @Depth > @MaxDepth + 1
                    THROW 51230, 'Subtask depth exceeds the space limit', 1;
            END
        END

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
            ParentTaskId, StoryPoints, DueDate, Position, ListId, ListPath
        ) VALUES (
            @NewId, @ProjectId, @WorkspaceId, @IssueKey, @Title, @Description,
            @Type, @Status, @Priority, @ReporterId, @SprintId, @EpicId,
            @ParentTaskId, @StoryPoints, @DueDate, @MaxPosition + 1000, @ListId, @ListPath
        );

        SELECT * FROM Tasks WHERE Id = @NewId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
