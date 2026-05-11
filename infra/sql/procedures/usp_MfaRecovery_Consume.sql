-- Deletes a single recovery code by id. Returns @@ROWCOUNT so the caller can
-- distinguish "code consumed" (1) from "already used / wrong id" (0).
CREATE OR ALTER PROCEDURE dbo.usp_MfaRecovery_Consume
    @CodeId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.MfaRecoveryCodes WHERE Id = @CodeId;
    SELECT @@ROWCOUNT AS RowsDeleted;
END;
