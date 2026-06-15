-- =============================================================================
-- usp_AppsEnabled_Set (Phase 10a)
-- Upsert ONE feature-toggle override for (WorkspaceId, ScopeType, ScopeId, AppKey).
--   @Enabled = NULL  -> DELETE the override (revert to inherited / registry default)
--   @Enabled = 0|1   -> MERGE (insert or update) the override row
-- @ScopeId is NULL for ScopeType='workspace' (the root scope). NULL-safe matching
-- on ScopeId throughout. Returns the row after the write (zero rows after a clear).
-- =============================================================================
CREATE OR ALTER PROCEDURE dbo.usp_AppsEnabled_Set
  @WorkspaceId UNIQUEIDENTIFIER,
  @ScopeType   NVARCHAR(12),
  @ScopeId     UNIQUEIDENTIFIER = NULL,
  @AppKey      NVARCHAR(40),
  @Enabled     BIT              = NULL,   -- NULL = clear the override (inherit)
  @UpdatedBy   UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  BEGIN TRY
    BEGIN TRANSACTION;

    IF @Enabled IS NULL
    BEGIN
      DELETE FROM dbo.AppsEnabled
      WHERE WorkspaceId = @WorkspaceId AND ScopeType = @ScopeType
        AND ((@ScopeId IS NULL AND ScopeId IS NULL) OR ScopeId = @ScopeId)
        AND AppKey = @AppKey;
    END
    ELSE
    BEGIN
      MERGE dbo.AppsEnabled AS tgt
      USING (SELECT @WorkspaceId AS WorkspaceId, @ScopeType AS ScopeType,
                    @ScopeId AS ScopeId, @AppKey AS AppKey) AS src
        ON  tgt.WorkspaceId = src.WorkspaceId
        AND tgt.ScopeType   = src.ScopeType
        AND ((src.ScopeId IS NULL AND tgt.ScopeId IS NULL) OR tgt.ScopeId = src.ScopeId)
        AND tgt.AppKey      = src.AppKey
      WHEN MATCHED THEN
        UPDATE SET Enabled = @Enabled, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (Id, WorkspaceId, ScopeType, ScopeId, AppKey, Enabled, UpdatedBy)
        VALUES (NEWID(), @WorkspaceId, @ScopeType, @ScopeId, @AppKey, @Enabled, @UpdatedBy);
    END

    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;

  SELECT ae.Id, ae.WorkspaceId, ae.ScopeType, ae.ScopeId, ae.AppKey, ae.Enabled,
         ae.UpdatedBy, ae.CreatedAt, ae.UpdatedAt
  FROM   dbo.AppsEnabled ae
  WHERE  ae.WorkspaceId = @WorkspaceId AND ae.ScopeType = @ScopeType
    AND  ((@ScopeId IS NULL AND ae.ScopeId IS NULL) OR ae.ScopeId = @ScopeId)
    AND  ae.AppKey = @AppKey;
END;
GO
