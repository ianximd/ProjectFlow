CREATE OR ALTER PROCEDURE dbo.usp_DocPage_GetById
    @PageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, BodyJson, CreatedAt, UpdatedAt
    FROM dbo.DocPages
    WHERE Id = @PageId AND DeletedAt IS NULL;
END;
GO
