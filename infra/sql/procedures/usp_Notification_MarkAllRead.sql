CREATE OR ALTER PROCEDURE usp_Notification_MarkAllRead
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Notifications
    SET IsRead = 1
    WHERE UserId = @UserId AND IsRead = 0;

    SELECT @@ROWCOUNT AS UpdatedCount;
END;
GO
