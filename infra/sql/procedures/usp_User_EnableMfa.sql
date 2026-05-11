CREATE OR ALTER PROCEDURE dbo.usp_User_EnableMfa
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Users
    SET    MfaEnabled   = 1,
           MfaEnabledAt = SYSUTCDATETIME()
    WHERE  Id = @UserId
      AND  MfaSecret IS NOT NULL
      AND  DeletedAt  IS NULL;
END;
