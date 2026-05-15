-- Updates the caller's own profile fields. Each field is opt-in: the caller
-- passes a non-NULL value to set Name; for AvatarUrl the @UpdateAvatar flag
-- distinguishes "no change" (0) from "explicit clear or set" (1) so we can
-- accept NULL as a meaningful value (clear the avatar).
CREATE OR ALTER PROCEDURE usp_User_UpdateProfile
    @UserId       UNIQUEIDENTIFIER,
    @Name         NVARCHAR(255) = NULL,
    @AvatarUrl    NVARCHAR(500) = NULL,
    @UpdateAvatar BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Users
    SET    Name      = COALESCE(@Name, Name),
           AvatarUrl = CASE WHEN @UpdateAvatar = 1 THEN @AvatarUrl ELSE AvatarUrl END,
           UpdatedAt = GETUTCDATE()
    WHERE  Id = @UserId
      AND  DeletedAt IS NULL;

    SELECT * FROM Users
    WHERE Id = @UserId AND DeletedAt IS NULL;
END;
