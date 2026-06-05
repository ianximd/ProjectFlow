CREATE OR ALTER PROCEDURE usp_Notification_SetSaved
    @Id     UNIQUEIDENTIFIER,
    @UserId UNIQUEIDENTIFIER,   -- ownership check
    @Saved  BIT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Notifications
    SET SavedForLater = @Saved,
        SavedAt       = CASE WHEN @Saved = 1 THEN GETUTCDATE() ELSE NULL END
    WHERE Id = @Id AND UserId = @UserId;

    IF @@ROWCOUNT = 0
        RAISERROR('NOTIFICATION_NOT_FOUND', 16, 1);
END;
GO
