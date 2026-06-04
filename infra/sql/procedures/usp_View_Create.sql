CREATE OR ALTER PROCEDURE dbo.usp_View_Create
    @Id          UNIQUEIDENTIFIER,
    @WorkspaceId UNIQUEIDENTIFIER,
    @OwnerId     UNIQUEIDENTIFIER,
    @ScopeType   NVARCHAR(12),
    @ScopeId     UNIQUEIDENTIFIER,
    @ScopePath   NVARCHAR(900),
    @Type        NVARCHAR(10),
    @Name        NVARCHAR(255),
    @IsShared    BIT,
    @IsDefault   BIT = 0,
    @Config      NVARCHAR(MAX),
    @Position    FLOAT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    BEGIN TRY
        IF @IsDefault = 1
            UPDATE dbo.SavedViews
               SET IsDefault = 0, UpdatedAt = SYSUTCDATETIME()
             WHERE WorkspaceId = @WorkspaceId AND ScopeType = @ScopeType
               AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
               AND Type = @Type AND DeletedAt IS NULL;

        INSERT INTO dbo.SavedViews (Id, WorkspaceId, OwnerId, ScopeType, ScopeId, ScopePath, Type, Name, IsShared, IsDefault, Config, Position)
        VALUES (@Id, @WorkspaceId, @OwnerId, @ScopeType, @ScopeId, @ScopePath, @Type, @Name, @IsShared, @IsDefault, @Config, @Position);

        COMMIT TRANSACTION;

        SELECT * FROM dbo.SavedViews WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
