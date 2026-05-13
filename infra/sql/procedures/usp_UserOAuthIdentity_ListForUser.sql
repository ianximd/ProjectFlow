-- Returns the providers a user has linked. Drives the "Connected accounts"
-- settings panel and the unlink-safety check on the API side.
CREATE OR ALTER PROCEDURE dbo.usp_UserOAuthIdentity_ListForUser
    @UserId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        Id,
        Provider,
        Subject,
        Email,
        TokenExpiresAt,
        CreatedAt
    FROM dbo.UserOAuthIdentities
    WHERE UserId = @UserId
    ORDER BY CreatedAt;
END;
GO
