CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Update
    @PageId UNIQUEIDENTIFIER,
    @Title  NVARCHAR(255)  = NULL,
    @Icon   NVARCHAR(64)   = NULL,
    @Cover  NVARCHAR(1024) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.DocPages
       SET Title     = ISNULL(@Title, Title),
           Icon      = ISNULL(@Icon, Icon),
           Cover     = ISNULL(@Cover, Cover),
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @PageId AND DeletedAt IS NULL;

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @PageId;
END;
GO
