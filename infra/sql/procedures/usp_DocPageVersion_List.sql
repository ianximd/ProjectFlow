CREATE OR ALTER PROCEDURE dbo.usp_DocPageVersion_List
    @PageId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.Id, v.PageId, v.CreatedById, u.Name AS CreatedByName, v.CreatedAt
    FROM dbo.DocPageVersions v
    JOIN dbo.Users u ON u.Id = v.CreatedById
    WHERE v.PageId = @PageId
    ORDER BY v.CreatedAt DESC;
END;
GO
