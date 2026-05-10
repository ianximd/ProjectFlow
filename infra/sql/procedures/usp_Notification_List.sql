CREATE OR ALTER PROCEDURE usp_Notification_List
    @UserId   UNIQUEIDENTIFIER,
    @Page     INT = 1,
    @PageSize INT = 20,
    @UnreadOnly BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Offset INT = (@Page - 1) * @PageSize;

    -- Notification rows
    SELECT
        n.Id,
        n.UserId,
        n.[Type],
        n.Payload,
        n.IsRead,
        n.CreatedAt
    FROM Notifications n
    WHERE n.UserId = @UserId
      AND (@UnreadOnly = 0 OR n.IsRead = 0)
    ORDER BY n.CreatedAt DESC
    OFFSET @Offset ROWS
    FETCH NEXT @PageSize ROWS ONLY;

    -- Unread count (second recordset — used by frontend badge)
    SELECT COUNT(*) AS UnreadCount
    FROM Notifications
    WHERE UserId = @UserId AND IsRead = 0;
END;
GO
