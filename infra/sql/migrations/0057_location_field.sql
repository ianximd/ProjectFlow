-- =============================================================================
-- Migration 0057: Location custom-field type (Phase 9f)
-- Adds 'location' to CK_CustomFields_Type so the Map view can plot tasks by a
-- per-task { "lat": number, "lng": number, "label": string } JSON value stored
-- in TaskCustomFieldValues.Value. The list below is the EXACT 0035 list with
-- 'location' appended; drop the old constraint (guarded) then re-add. WITH
-- NOCHECK is unnecessary -- we are only WIDENING the allowed set, so every
-- existing CustomFields row still satisfies the new constraint.
-- Idempotent (sys-catalog guard), GO-batched.
-- (Renumbered from the plan's 0050 -- on-disk migration tip was 0056.)
-- Rollback in rollback/0057_location_field.down.sql.
-- =============================================================================

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CustomFields_Type')
    ALTER TABLE dbo.CustomFields DROP CONSTRAINT CK_CustomFields_Type;
GO
ALTER TABLE dbo.CustomFields ADD CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
    'text','text_area','number','currency','checkbox','date','url','email','phone',
    'dropdown','labels','rating','people','progress_manual','progress_auto',
    'relationship','rollup','location'));
GO
