CREATE OR ALTER PROCEDURE usp_RefreshToken_Create
    @UserId    UNIQUEIDENTIFIER,
    @TokenHash NVARCHAR(255),
    @ExpiresAt DATETIME2
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

    INSERT INTO RefreshTokens (Id, UserId, TokenHash, ExpiresAt)
    VALUES (@NewId, @UserId, @TokenHash, @ExpiresAt);

    SELECT * FROM RefreshTokens WHERE Id = @NewId;
END;
