-- Rollback 0048: restore CK_SavedViews_Type to the original four view types.
-- WARNING: this FAILS if any SavedViews row currently has Type 'workload' or 'box'
-- (the narrowed CHECK would be violated). Remove/convert such rows first.
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_SavedViews_Type'
      AND parent_object_id = OBJECT_ID('dbo.SavedViews')
)
BEGIN
    ALTER TABLE dbo.SavedViews DROP CONSTRAINT CK_SavedViews_Type;
END;
GO

ALTER TABLE dbo.SavedViews
    ADD CONSTRAINT CK_SavedViews_Type
    CHECK (Type IN ('list','board','table','calendar'));
GO
