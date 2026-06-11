CREATE OR ALTER PROCEDURE dbo.usp_Form_Update
    @Id            UNIQUEIDENTIFIER,
    @Name          NVARCHAR(255) = NULL,
    @Config        NVARCHAR(MAX) = NULL,
    @TargetListId  UNIQUEIDENTIFIER = NULL,
    @FieldMapping  NVARCHAR(MAX) = NULL,
    @TemplateId    UNIQUEIDENTIFIER = NULL,
    @ClearTemplate BIT = 0,
    @IsPublic      BIT = NULL,
    @PublicSlug    NVARCHAR(64) = NULL,
    @ClearSlug     BIT = 0,
    @AuthRequired  BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        -- A changed TargetListId must stay inside the form's own workspace
        -- (the create guard validates this; the update path must too, else a
        -- form could be re-pointed at another tenant's list).
        IF @TargetListId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.Lists L
            JOIN dbo.Forms F ON F.Id = @Id
            WHERE L.Id = @TargetListId AND L.WorkspaceId = F.WorkspaceId AND L.DeletedAt IS NULL)
            THROW 51422, 'Target list not found in workspace', 1;

        UPDATE dbo.Forms SET
            Name         = ISNULL(@Name,         Name),
            Config       = ISNULL(@Config,       Config),
            TargetListId = ISNULL(@TargetListId, TargetListId),
            FieldMapping = ISNULL(@FieldMapping, FieldMapping),
            TemplateId   = CASE WHEN @ClearTemplate = 1 THEN NULL ELSE ISNULL(@TemplateId, TemplateId) END,
            IsPublic     = ISNULL(@IsPublic,     IsPublic),
            PublicSlug   = CASE WHEN @ClearSlug = 1 THEN NULL ELSE ISNULL(@PublicSlug, PublicSlug) END,
            AuthRequired = ISNULL(@AuthRequired, AuthRequired),
            UpdatedAt    = SYSUTCDATETIME()
        WHERE Id = @Id AND DeletedAt IS NULL;

        SELECT * FROM dbo.Forms WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
GO
