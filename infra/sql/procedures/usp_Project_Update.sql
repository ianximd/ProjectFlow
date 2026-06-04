CREATE OR ALTER PROCEDURE usp_Project_Update
    @Id          UNIQUEIDENTIFIER,
    @Name        NVARCHAR(255)    = NULL,
    @Description NVARCHAR(MAX)    = NULL,
    @AvatarUrl   NVARCHAR(500)    = NULL,
    @Type        NVARCHAR(20)     = NULL,
    @StartDate   DATE             = NULL,
    @EndDate     DATE             = NULL,
    -- Hierarchy (0029): Space-level visibility + subtask depth. Both NULL = leave as-is.
    @Visibility       NVARCHAR(10) = NULL,
    @MaxSubtaskDepth  INT          = NULL,
    -- Phase 2 (0030): Space-level multiple-assignees toggle. NULL = leave as-is.
    @MultipleAssignees BIT         = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE Projects
        SET
            Name        = ISNULL(@Name,        Name),
            Description = ISNULL(@Description, Description),
            AvatarUrl   = ISNULL(@AvatarUrl,   AvatarUrl),
            Type        = ISNULL(@Type,        Type),
            StartDate   = ISNULL(@StartDate,   StartDate),
            EndDate     = ISNULL(@EndDate,     EndDate),
            Visibility       = ISNULL(@Visibility,      Visibility),
            MaxSubtaskDepth  = ISNULL(@MaxSubtaskDepth, MaxSubtaskDepth),
            MultipleAssignees = ISNULL(@MultipleAssignees, MultipleAssignees),
            UpdatedAt   = GETUTCDATE()
        WHERE Id = @Id
          AND Status <> 'DELETED';

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRANSACTION;
            RAISERROR('PROJECT_NOT_FOUND', 16, 1);
            RETURN;
        END;

        SELECT * FROM Projects WHERE Id = @Id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
