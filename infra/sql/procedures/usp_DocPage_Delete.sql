CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Delete
    @PageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME2 = SYSUTCDATETIME();

    ;WITH Subtree AS (
        SELECT Id FROM dbo.DocPages WHERE Id = @PageId
        UNION ALL
        SELECT c.Id FROM dbo.DocPages c JOIN Subtree s ON c.ParentPageId = s.Id
    )
    UPDATE p SET DeletedAt = @Now, UpdatedAt = @Now
    FROM dbo.DocPages p
    JOIN Subtree s ON s.Id = p.Id
    WHERE p.DeletedAt IS NULL;
END;
GO
