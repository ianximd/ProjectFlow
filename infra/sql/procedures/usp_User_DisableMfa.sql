CREATE OR ALTER PROCEDURE dbo.usp_User_DisableMfa
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        UPDATE dbo.Users
        SET    MfaEnabled   = 0,
               MfaSecret    = NULL,
               MfaEnabledAt = NULL
        WHERE  Id = @UserId
          AND  DeletedAt IS NULL;

        DELETE FROM dbo.MfaRecoveryCodes WHERE UserId = @UserId;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
