CREATE OR ALTER PROCEDURE dbo.usp_DocPageVersion_GetById
    @VersionId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, PageId, Snapshot, CreatedById, CreatedAt
    FROM dbo.DocPageVersions
    WHERE Id = @VersionId;
END;
GO
