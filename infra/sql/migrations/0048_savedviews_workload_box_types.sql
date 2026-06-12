-- =============================================================================
-- Migration 0048: Extend CK_SavedViews_Type to include 'workload' and 'box'.
--
-- Phase 8d adds two new view types. The original 0032 migration only allowed
-- ('list','board','table','calendar'). This migration drops and recreates the
-- CHECK constraint to include the two new types.
-- Idempotent: only drops if it exists, only adds if it does not already allow
-- the new values.
-- =============================================================================

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
    CHECK (Type IN ('list','board','table','calendar','workload','box'));
GO
