CREATE OR ALTER PROCEDURE usp_Notification_List
    @UserId     UNIQUEIDENTIFIER,
    @Page       INT = 1,
    @PageSize   INT = 20,
    @UnreadOnly BIT = 0,
    @Types      NVARCHAR(MAX) = NULL,
    @SavedOnly  BIT = 0
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
        n.SavedForLater,
        n.SavedAt,
        n.CreatedAt
    FROM Notifications n
    WHERE n.UserId = @UserId
      AND (@UnreadOnly = 0 OR n.IsRead = 0)
      AND (@SavedOnly  = 0 OR n.SavedForLater = 1)
      AND (@Types IS NULL OR n.[Type] IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Types, ',')))
    ORDER BY n.CreatedAt DESC
    OFFSET @Offset ROWS
    FETCH NEXT @PageSize ROWS ONLY;

    -- Unread count (second recordset — used by frontend badge)
    SELECT COUNT(*) AS UnreadCount
    FROM Notifications
    WHERE UserId = @UserId AND IsRead = 0;
END;
GO
