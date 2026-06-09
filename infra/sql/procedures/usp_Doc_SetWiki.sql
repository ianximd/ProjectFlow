CREATE OR ALTER PROCEDURE dbo.usp_Doc_SetWiki
    @DocId        UNIQUEIDENTIFIER,
    @IsWiki       BIT,
    @VerifiedById UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Docs
       SET IsWiki       = @IsWiki,
           VerifiedById = CASE WHEN @IsWiki = 1 THEN @VerifiedById ELSE NULL END,
           UpdatedAt    = SYSUTCDATETIME()
     WHERE Id = @DocId AND DeletedAt IS NULL;

    SELECT Id, WorkspaceId, ScopeType, ScopeId, Name, Icon, IsWiki, VerifiedById, CreatedById, CreatedAt, UpdatedAt
    FROM dbo.Docs WHERE Id = @DocId AND DeletedAt IS NULL;
END;
GO
