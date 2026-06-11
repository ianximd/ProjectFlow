CREATE OR ALTER PROCEDURE dbo.usp_Form_Create
    @Id           UNIQUEIDENTIFIER,
    @WorkspaceId  UNIQUEIDENTIFIER,
    @ScopeType    NVARCHAR(8),
    @ScopeId      UNIQUEIDENTIFIER,
    @Name         NVARCHAR(255),
    @Config       NVARCHAR(MAX),
    @TargetListId UNIQUEIDENTIFIER,
    @FieldMapping NVARCHAR(MAX),
    @TemplateId   UNIQUEIDENTIFIER = NULL,
    @IsPublic     BIT             = 0,
    @PublicSlug   NVARCHAR(64)    = NULL,
    @AuthRequired BIT             = 0,
    @CreatedById  UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        IF NOT EXISTS (SELECT 1 FROM dbo.Lists WHERE Id = @TargetListId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51420, 'Target list not found in workspace', 1;
        IF @TemplateId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Templates WHERE Id = @TemplateId AND WorkspaceId = @WorkspaceId AND DeletedAt IS NULL)
            THROW 51421, 'Template not found in workspace', 1;

        INSERT INTO dbo.Forms
            (Id, WorkspaceId, ScopeType, ScopeId, Name, Config, TargetListId, FieldMapping,
             TemplateId, IsPublic, PublicSlug, AuthRequired, CreatedById)
        VALUES
            (@Id, @WorkspaceId, @ScopeType, @ScopeId, @Name, @Config, @TargetListId, @FieldMapping,
             @TemplateId, @IsPublic, @PublicSlug, @AuthRequired, @CreatedById);

        SELECT * FROM dbo.Forms WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
