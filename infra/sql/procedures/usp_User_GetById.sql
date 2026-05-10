CREATE OR ALTER PROCEDURE usp_User_GetById
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, Email, Name, AvatarUrl, IsEmailVerified, MfaEnabled, CreatedAt, UpdatedAt
    FROM   Users
    WHERE  Id = @UserId
      AND  DeletedAt IS NULL;
END;
