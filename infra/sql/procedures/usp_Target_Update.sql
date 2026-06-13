-- Phase 8e: update a target's editable fields (NULL = leave unchanged). Used for
-- the user-maintained CurrentValue on number/currency/boolean targets and for
-- editing name/unit/start/target/filter. SELECT * of the updated row.
CREATE OR ALTER PROCEDURE dbo.usp_Target_Update
    @Id           UNIQUEIDENTIFIER,
    @Name         NVARCHAR(300) = NULL,
    @Unit         NVARCHAR(20) = NULL,
    @CurrencyCode CHAR(3) = NULL,
    @StartValue   FLOAT = NULL,
    @TargetValue  FLOAT = NULL,
    @CurrentValue FLOAT = NULL,
    @TaskFilter   NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        UPDATE dbo.Targets
        SET Name         = COALESCE(@Name, Name),
            Unit         = COALESCE(@Unit, Unit),
            CurrencyCode = COALESCE(@CurrencyCode, CurrencyCode),
            StartValue   = COALESCE(@StartValue, StartValue),
            TargetValue  = COALESCE(@TargetValue, TargetValue),
            CurrentValue = COALESCE(@CurrentValue, CurrentValue),
            TaskFilter   = COALESCE(@TaskFilter, TaskFilter),
            UpdatedAt    = SYSUTCDATETIME()
        WHERE Id = @Id;
        SELECT * FROM dbo.Targets WHERE Id = @Id;
    END TRY
    BEGIN CATCH
        THROW;
    END CATCH
END;
