CREATE OR ALTER PROCEDURE dbo.usp_DocPage_Restore
    @PageId      UNIQUEIDENTIFIER,
    @VersionId   UNIQUEIDENTIFIER,
    @CreatedById UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Snapshot NVARCHAR(MAX);
    DECLARE @CurrentJson NVARCHAR(MAX);

    SELECT @Snapshot = Snapshot FROM dbo.DocPageVersions WHERE Id = @VersionId AND PageId = @PageId;
    IF @Snapshot IS NULL
        THROW 51701, 'Version not found for this page', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Checkpoint the CURRENT body before overwriting (so restore is itself undoable).
        SELECT @CurrentJson = BodyJson FROM dbo.DocPages WHERE Id = @PageId AND DeletedAt IS NULL;
        IF @CurrentJson IS NOT NULL
            INSERT INTO dbo.DocPageVersions (Id, PageId, Snapshot, CreatedById)
            VALUES (NEWID(), @PageId, @CurrentJson, @CreatedById);

        UPDATE dbo.DocPages
           SET BodyJson  = @Snapshot,
               BodyYjs   = NULL,           -- force re-seed from JSON on next collab connect
               UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @PageId AND DeletedAt IS NULL;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT Id, DocId, ParentPageId, Title, Icon, Cover, Position, BodyJson, CreatedAt, UpdatedAt
    FROM dbo.DocPages WHERE Id = @PageId;
END;
GO
