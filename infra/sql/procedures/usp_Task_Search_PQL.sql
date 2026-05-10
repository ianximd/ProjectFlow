CREATE OR ALTER PROCEDURE usp_Task_Search_PQL
    @WorkspaceId  UNIQUEIDENTIFIER,
    @ProjectId    UNIQUEIDENTIFIER = NULL,
    @Query        NVARCHAR(500)    = NULL,   -- free-text (LIKE on Title + Description)
    @Type         NVARCHAR(20)     = NULL,
    @Status       NVARCHAR(100)    = NULL,
    @Priority     NVARCHAR(20)     = NULL,
    @AssigneeId   UNIQUEIDENTIFIER = NULL,
    @ReporterId   UNIQUEIDENTIFIER = NULL,
    @SprintId     UNIQUEIDENTIFIER = NULL,
    @OpenSprints  BIT              = 0,      -- 1 = tasks in any ACTIVE sprint
    @DueAfter     DATE             = NULL,
    @DueBefore    DATE             = NULL,
    @CreatedAfter DATETIME2        = NULL,
    @UpdatedAfter DATETIME2        = NULL,
    @OrderBy      NVARCHAR(50)     = N'CreatedAt',
    @OrderDir     NVARCHAR(4)      = N'DESC',
    @Page         INT              = 1,
    @PageSize     INT              = 25
AS
BEGIN
    SET NOCOUNT ON;

    -- Clamp page size
    IF @PageSize > 100 SET @PageSize = 100;
    IF @PageSize < 1   SET @PageSize = 1;

    DECLARE @Offset INT = (@Page - 1) * @PageSize;

    -- Build search term for LIKE (wrap in wildcards)
    DECLARE @LikeQ NVARCHAR(502) = NULL;
    IF @Query IS NOT NULL AND LEN(LTRIM(RTRIM(@Query))) > 0
        SET @LikeQ = N'%' + LTRIM(RTRIM(@Query)) + N'%';

    -- Validate @OrderBy to prevent SQL injection (allow-list)
    IF @OrderBy NOT IN (N'CreatedAt', N'UpdatedAt', N'DueDate', N'Priority', N'Status', N'Title', N'StoryPoints')
        SET @OrderBy = N'CreatedAt';

    IF @OrderDir NOT IN (N'ASC', N'DESC')
        SET @OrderDir = N'DESC';

    -- Main query
    ;WITH Results AS (
        SELECT
            t.Id,
            t.IssueKey,
            t.Title,
            t.Description,
            t.[Type],
            t.Status,
            t.Priority,
            t.StoryPoints,
            t.DueDate,
            t.CreatedAt,
            t.UpdatedAt,
            t.ProjectId,
            t.SprintId,
            t.ReporterId,
            p.Name  AS ProjectName,
            p.[Key] AS ProjectKey,
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE WHEN @OrderBy = N'CreatedAt'   AND @OrderDir = N'DESC' THEN t.CreatedAt   END DESC,
                    CASE WHEN @OrderBy = N'CreatedAt'   AND @OrderDir = N'ASC'  THEN t.CreatedAt   END ASC,
                    CASE WHEN @OrderBy = N'UpdatedAt'   AND @OrderDir = N'DESC' THEN t.UpdatedAt   END DESC,
                    CASE WHEN @OrderBy = N'UpdatedAt'   AND @OrderDir = N'ASC'  THEN t.UpdatedAt   END ASC,
                    CASE WHEN @OrderBy = N'DueDate'     AND @OrderDir = N'DESC' THEN t.DueDate     END DESC,
                    CASE WHEN @OrderBy = N'DueDate'     AND @OrderDir = N'ASC'  THEN t.DueDate     END ASC,
                    CASE WHEN @OrderBy = N'Title'       AND @OrderDir = N'DESC' THEN t.Title       END DESC,
                    CASE WHEN @OrderBy = N'Title'       AND @OrderDir = N'ASC'  THEN t.Title       END ASC,
                    t.CreatedAt DESC   -- secondary sort
            ) AS RowNum,
            COUNT(*) OVER () AS TotalCount
        FROM Tasks t
        INNER JOIN Projects p ON p.Id = t.ProjectId
        WHERE t.DeletedAt IS NULL
          -- Workspace scope via project ownership
          AND p.WorkspaceId = @WorkspaceId
          -- Optional project filter
          AND (@ProjectId IS NULL OR t.ProjectId = @ProjectId)
          -- Full-text / LIKE search
          AND (@LikeQ IS NULL
               OR t.Title       LIKE @LikeQ
               OR t.Description LIKE @LikeQ
               OR t.IssueKey    LIKE @LikeQ)
          -- Field filters
          AND (@Type     IS NULL OR t.[Type]    = @Type)
          AND (@Status   IS NULL OR t.Status    = @Status)
          AND (@Priority IS NULL OR t.Priority  = @Priority)
          AND (@ReporterId IS NULL OR t.ReporterId = @ReporterId)
          AND (@AssigneeId IS NULL OR t.Id IN (
              SELECT TaskId FROM TaskAssignees WHERE UserId = @AssigneeId))
          AND (@SprintId IS NULL OR t.SprintId = @SprintId)
          AND (@OpenSprints = 0 OR t.SprintId IN (
              SELECT Id FROM Sprints WHERE Status = N'ACTIVE'))
          -- Date range filters
          AND (@DueAfter    IS NULL OR t.DueDate   >= @DueAfter)
          AND (@DueBefore   IS NULL OR t.DueDate   <= @DueBefore)
          AND (@CreatedAfter IS NULL OR t.CreatedAt >= @CreatedAfter)
          AND (@UpdatedAfter IS NULL OR t.UpdatedAt >= @UpdatedAfter)
    )
    SELECT
        Id, IssueKey, Title, [Type], Status, Priority,
        StoryPoints, DueDate, CreatedAt, UpdatedAt,
        ProjectId, ProjectName, ProjectKey, SprintId, ReporterId,
        TotalCount
    FROM Results
    WHERE RowNum > @Offset AND RowNum <= (@Offset + @PageSize)
    ORDER BY RowNum;
END;
GO
