CREATE OR ALTER PROCEDURE usp_User_Create
    @Email        NVARCHAR(255),
    @Name         NVARCHAR(255),
    @PasswordHash NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF EXISTS (SELECT 1 FROM Users WHERE Email = @Email AND DeletedAt IS NULL)
        BEGIN
            THROW 50001, 'Email is already registered.', 1;
        END

        DECLARE @NewId UNIQUEIDENTIFIER = NEWID();

        INSERT INTO Users (Id, Email, Name, PasswordHash)
        VALUES (@NewId, @Email, @Name, @PasswordHash);

        SELECT * FROM Users WHERE Id = @NewId;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
