-- Rollback 0035: relationships + rollup custom-field types.
-- Drops the TaskRelationships table and restores CK_CustomFields_Type to the
-- 0030 list (without 'relationship'/'rollup'). NOTE: re-adding the narrower
-- CHECK will FAIL if any CustomFields row still uses the dropped types — delete
-- those rows first in that case (destructive; not done automatically here).

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskRelationships')
    DROP TABLE dbo.TaskRelationships;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CustomFields_Type')
    ALTER TABLE dbo.CustomFields DROP CONSTRAINT CK_CustomFields_Type;
GO
ALTER TABLE dbo.CustomFields ADD CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
    'text','text_area','number','currency','checkbox','date','url','email','phone',
    'dropdown','labels','rating','people','progress_manual','progress_auto'));
GO
