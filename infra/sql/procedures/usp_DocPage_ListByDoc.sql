CREATE OR ALTER PROCEDURE dbo.usp_DocPage_ListByDoc
    @DocId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, DocId, ParentPageId, Title, Icon, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages
    WHERE DocId = @DocId AND DeletedAt IS NULL
    ORDER BY ParentPageId, Position;
END;
GO
