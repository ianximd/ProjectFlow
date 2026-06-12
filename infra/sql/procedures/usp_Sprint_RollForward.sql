CREATE OR ALTER PROCEDURE dbo.usp_Sprint_RollForward
    @FromSprintId UNIQUEIDENTIFIER,
    @ToSprintId   UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @ToListId UNIQUEIDENTIFIER, @ToListPath NVARCHAR(900);
        SELECT @ToListId = l.Id, @ToListPath = l.Path
        FROM   dbo.Sprints s JOIN dbo.Lists l ON l.Id = s.ListId
        WHERE  s.Id = @ToSprintId;
        IF @ToListId IS NULL
            THROW 50047, 'Target sprint has no List.', 1;

        DECLARE @FromListId UNIQUEIDENTIFIER;
        SELECT @FromListId = ListId FROM dbo.Sprints WHERE Id = @FromSprintId;

        -- Move unfinished tasks from the SOURCE sprint's List into the target
        -- sprint's List, maintaining the SprintId denorm. Membership is keyed on
        -- the source List (Tasks.ListId = @FromListId), NOT on Tasks.SprintId:
        -- usp_Sprint_Complete already nulls SprintId on unfinished tasks when a
        -- sprint completes (leaving ListId intact), so a SprintId predicate would
        -- match nothing after an auto-complete. The List is the authoritative
        -- membership signal in the sprint-folder model (1:1 sprint<->List via
        -- UQ_Sprint_List). DONE-category tasks stay behind in the completed sprint.
        UPDATE dbo.Tasks
        SET    ListId = @ToListId, ListPath = @ToListPath, SprintId = @ToSprintId, UpdatedAt = GETUTCDATE()
        WHERE  ListId = @FromListId
          AND  ResolvedAt IS NULL
          AND  Status NOT IN ('Done','DONE')
          AND  DeletedAt IS NULL;

        DECLARE @Rolled INT = @@ROWCOUNT;
        COMMIT TRANSACTION;

        SELECT @Rolled AS Rolled;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
