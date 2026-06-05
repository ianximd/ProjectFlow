CREATE OR ALTER PROCEDURE usp_User_GetDisplay
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, Name, AvatarUrl
    FROM   Users
    WHERE  Id = @Id;
END;
GO
