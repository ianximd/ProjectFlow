-- Rollback 0056: drop BaselineTasks + Baselines, and restore the pre-0056
-- CK_SavedViews_Type — the SIX-type state migration 0048 left in place
-- ('list','board','table','calendar','workload','box'). NOT the original
-- four-type CHECK: 0048 already extended it for workload/box, and reverting to
-- four types would orphan any existing workload/box SavedViews rows.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BaselineTasks') DROP TABLE dbo.BaselineTasks;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Baselines')     DROP TABLE dbo.Baselines;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SavedViews_Type' AND parent_object_id = OBJECT_ID('dbo.SavedViews'))
    ALTER TABLE dbo.SavedViews DROP CONSTRAINT CK_SavedViews_Type;
GO

ALTER TABLE dbo.SavedViews WITH CHECK ADD CONSTRAINT CK_SavedViews_Type
    CHECK (Type IN ('list','board','table','calendar','workload','box'));
GO
