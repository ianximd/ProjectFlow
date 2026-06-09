CREATE OR ALTER PROCEDURE dbo.usp_DocPageVersion_Create
    @PageId      UNIQUEIDENTIFIER,
    @Snapshot    NVARCHAR(MAX),
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.DocPageVersions (Id, PageId, Snapshot, CreatedById)
    VALUES (@Id, @PageId, @Snapshot, @CreatedById);

    SELECT v.Id, v.PageId, v.CreatedById, u.Name AS CreatedByName, v.CreatedAt
    FROM dbo.DocPageVersions v
    JOIN dbo.Users u ON u.Id = v.CreatedById
    WHERE v.Id = @Id;
END;
GO
