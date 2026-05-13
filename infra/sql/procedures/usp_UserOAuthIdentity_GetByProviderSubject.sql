-- Looks up an OAuth identity by (Provider, Subject). Returns the row's
-- UserId so the caller can issue session tokens for an existing account
-- without a second round-trip. Empty result set when no such identity
-- exists (caller treats this as "new sign-in, create the user").
CREATE OR ALTER PROCEDURE dbo.usp_UserOAuthIdentity_GetByProviderSubject
    @Provider NVARCHAR(32),
    @Subject  NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        Id,
        UserId,
        Provider,
        Subject,
        Email,
        TokenExpiresAt,
        CreatedAt,
        UpdatedAt
    FROM dbo.UserOAuthIdentities
    WHERE Provider = @Provider AND Subject = @Subject;
END;
GO
