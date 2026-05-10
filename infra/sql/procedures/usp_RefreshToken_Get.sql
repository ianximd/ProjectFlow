CREATE OR ALTER PROCEDURE usp_RefreshToken_Get
    @TokenHash NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT * 
    FROM RefreshTokens 
    WHERE TokenHash = @TokenHash;
END;
