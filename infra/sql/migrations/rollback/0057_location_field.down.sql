-- Rollback 0057: location custom-field type.
-- Restores CK_CustomFields_Type to the 0035 list (without 'location'). NOTE:
-- re-adding the narrower CHECK will FAIL if any CustomFields row still uses the
-- 'location' type -- delete those rows first in that case (destructive; not done
-- automatically here, mirroring the 0035 rollback note).

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CustomFields_Type')
    ALTER TABLE dbo.CustomFields DROP CONSTRAINT CK_CustomFields_Type;
GO
ALTER TABLE dbo.CustomFields ADD CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
    'text','text_area','number','currency','checkbox','date','url','email','phone',
    'dropdown','labels','rating','people','progress_manual','progress_auto',
    'relationship','rollup'));
GO
