CREATE OR ALTER PROCEDURE dbo.usp_User_GetMfaState
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 MfaEnabled, MfaSecret, MfaEnabledAt
    FROM   dbo.Users
    WHERE  Id = @UserId
      AND  DeletedAt IS NULL;
END;
