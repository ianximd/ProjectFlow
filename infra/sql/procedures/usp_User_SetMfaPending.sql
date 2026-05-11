-- Stores a candidate TOTP secret on the user record without enabling MFA.
-- The flow: setup → user scans QR → user submits first code → if valid,
-- usp_User_EnableMfa is called and MfaEnabled flips to 1.
CREATE OR ALTER PROCEDURE dbo.usp_User_SetMfaPending
    @UserId UNIQUEIDENTIFIER,
    @Secret NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    -- Refuse if MFA is already enabled — caller must disable first.
    IF EXISTS (SELECT 1 FROM dbo.Users WHERE Id = @UserId AND MfaEnabled = 1)
        THROW 51020, 'MFA is already enabled for this user', 1;

    UPDATE dbo.Users
    SET    MfaSecret    = @Secret,
           MfaEnabled   = 0,
           MfaEnabledAt = NULL
    WHERE  Id = @UserId
      AND  DeletedAt IS NULL;
END;
