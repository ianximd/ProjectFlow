CREATE OR ALTER PROCEDURE dbo.usp_DocPage_LoadYjs
    @PageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT BodyYjs, BodyJson
    FROM dbo.DocPages
    WHERE Id = @PageId AND DeletedAt IS NULL;
END;
GO
