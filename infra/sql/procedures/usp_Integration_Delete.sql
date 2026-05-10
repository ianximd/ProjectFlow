CREATE OR ALTER PROCEDURE dbo.usp_Integration_Delete
    @Id UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.IntegrationConnections
    WHERE  Id = @Id;
END;
