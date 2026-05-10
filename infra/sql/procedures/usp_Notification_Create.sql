CREATE OR ALTER PROCEDURE usp_Notification_Create
    @UserId  UNIQUEIDENTIFIER,
    @Type    NVARCHAR(50),
    @Payload NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

    INSERT INTO Notifications (Id, UserId, Type, Payload)
    VALUES (@NewId, @UserId, @Type, @Payload);

    SELECT
        Id, UserId, [Type], Payload, IsRead, CreatedAt
    FROM Notifications
    WHERE Id = @NewId;
END;
GO
