CREATE OR ALTER PROCEDURE usp_Notification_MarkRead
    @Id     UNIQUEIDENTIFIER,
    @UserId UNIQUEIDENTIFIER   -- ownership check
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Notifications
    SET IsRead = 1
    WHERE Id = @Id AND UserId = @UserId;

    IF @@ROWCOUNT = 0
        RAISERROR('NOTIFICATION_NOT_FOUND', 16, 1);
END;
GO
