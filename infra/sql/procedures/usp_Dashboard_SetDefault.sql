CREATE OR ALTER PROCEDURE dbo.usp_Dashboard_SetDefault
  @Id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @WorkspaceId UNIQUEIDENTIFIER, @ScopeType NVARCHAR(12), @ScopeId UNIQUEIDENTIFIER;
    SELECT @WorkspaceId = WorkspaceId, @ScopeType = ScopeType, @ScopeId = ScopeId
      FROM dbo.Dashboards WHERE Id = @Id AND DeletedAt IS NULL;

    UPDATE dbo.Dashboards SET IsDefault = 0, UpdatedAt = SYSUTCDATETIME()
     WHERE WorkspaceId = @WorkspaceId AND ScopeType = @ScopeType
       AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
       AND DeletedAt IS NULL AND IsDefault = 1 AND Id <> @Id;

    UPDATE dbo.Dashboards SET IsDefault = 1, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id;

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT * FROM dbo.Dashboards WHERE Id = @Id;
END;
GO
