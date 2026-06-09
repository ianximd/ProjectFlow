CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Move
    @PageId       UNIQUEIDENTIFIER,
    @ParentPageId UNIQUEIDENTIFIER = NULL,
    @Position     FLOAT
AS
BEGIN
    SET NOCOUNT ON;

    -- Cycle guard: the new parent must not be the page itself or one of its descendants.
    IF @ParentPageId IS NOT NULL
    BEGIN
        IF @ParentPageId = @PageId
            THROW 51700, 'A page cannot be its own parent', 1;

        -- A CTE must be consumed by a single statement, so capture the
        -- descendant-membership result into a flag and branch on it (a bare
        -- IF cannot immediately follow a WITH clause).
        DECLARE @IsDescendant BIT = 0;
        ;WITH Descendants AS (
            SELECT Id FROM dbo.DocPages WHERE Id = @PageId
            UNION ALL
            SELECT c.Id FROM dbo.DocPages c JOIN Descendants d ON c.ParentPageId = d.Id
        )
        SELECT @IsDescendant = 1 FROM Descendants WHERE Id = @ParentPageId;

        IF @IsDescendant = 1
            THROW 51700, 'Cannot move a page under its own descendant', 1;
    END

    UPDATE dbo.DocPages
       SET ParentPageId = @ParentPageId,
           Position     = @Position,
           UpdatedAt    = SYSUTCDATETIME()
     WHERE Id = @PageId AND DeletedAt IS NULL;

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @PageId;
END;
GO
