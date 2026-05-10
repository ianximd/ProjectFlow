CREATE OR ALTER PROCEDURE usp_User_GetByEmail
    @Email NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT * 
    FROM Users 
    WHERE Email = @Email AND DeletedAt IS NULL;
END;
