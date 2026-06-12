CREATE OR ALTER PROCEDURE dbo.usp_Folder_SetSprintSettings
    @FolderId        UNIQUEIDENTIFIER,
    @DurationDays    INT,
    @StartDayOfWeek  TINYINT = NULL,
    @AutoStart       BIT,
    @AutoComplete    BIT,
    @AutoRollForward BIT,
    @PointsFieldId   UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM dbo.Folders WHERE Id = @FolderId AND DeletedAt IS NULL)
            THROW 50045, 'Folder not found.', 1;

        UPDATE dbo.Folders SET IsSprintFolder = 1, UpdatedAt = GETUTCDATE() WHERE Id = @FolderId;

        IF EXISTS (SELECT 1 FROM dbo.SprintSettings WHERE FolderId = @FolderId)
            UPDATE dbo.SprintSettings
            SET DurationDays = @DurationDays, StartDayOfWeek = @StartDayOfWeek,
                AutoStart = @AutoStart, AutoComplete = @AutoComplete,
                AutoRollForward = @AutoRollForward, PointsFieldId = @PointsFieldId,
                UpdatedAt = GETUTCDATE()
            WHERE FolderId = @FolderId;
        ELSE
            INSERT INTO dbo.SprintSettings (FolderId, DurationDays, StartDayOfWeek, AutoStart, AutoComplete, AutoRollForward, PointsFieldId)
            VALUES (@FolderId, @DurationDays, @StartDayOfWeek, @AutoStart, @AutoComplete, @AutoRollForward, @PointsFieldId);

        COMMIT TRANSACTION;

        SELECT * FROM dbo.SprintSettings WHERE FolderId = @FolderId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
