CREATE OR ALTER PROCEDURE usp_User_UpdatePassword
    @UserId       UNIQUEIDENTIFIER,
    @PasswordHash NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE Users
    SET    PasswordHash = @PasswordHash,
           UpdatedAt    = GETUTCDATE()
    WHERE  Id = @UserId
      AND  DeletedAt IS NULL;
END;
