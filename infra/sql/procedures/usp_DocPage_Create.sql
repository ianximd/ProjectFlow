CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Create
    @DocId        UNIQUEIDENTIFIER,
    @ParentPageId UNIQUEIDENTIFIER = NULL,
    @Title        NVARCHAR(255)    = N'Untitled',
    @Icon         NVARCHAR(64)     = NULL,
    @Position     FLOAT            = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Id UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.DocPages (Id, DocId, ParentPageId, Title, Icon, Position)
    VALUES (@Id, @DocId, @ParentPageId, @Title, @Icon, @Position);

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @Id;
END;
GO
