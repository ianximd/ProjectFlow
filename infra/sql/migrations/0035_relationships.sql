-- =============================================================================
-- Migration 0035: Relationships + Rollup custom-field types (Phase 5b)
-- New table: TaskRelationships (link table — source of truth for `relationship`
--   custom-field values, NOT TaskCustomFieldValues, so reverse lookups + rollup
--   are clean SQL).
-- Alters: extend CK_CustomFields_Type with 'relationship' and 'rollup'.
-- Idempotent (sys-catalog / COL_LENGTH guards), GO-batched.
-- Rollback in rollback/0035_relationships.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TaskRelationships')
BEGIN
    CREATE TABLE dbo.TaskRelationships (
        Id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        FieldId     UNIQUEIDENTIFIER NOT NULL,    -- the 'relationship' CustomFields row
        FromTaskId  UNIQUEIDENTIFIER NOT NULL,
        ToTaskId    UNIQUEIDENTIFIER NOT NULL,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_TaskRel UNIQUE (FieldId, FromTaskId, ToTaskId)
    );
    CREATE NONCLUSTERED INDEX IX_TaskRel_FieldFrom  ON dbo.TaskRelationships (FieldId, FromTaskId);
    CREATE NONCLUSTERED INDEX IX_TaskRel_FieldTo    ON dbo.TaskRelationships (FieldId, ToTaskId);
    CREATE NONCLUSTERED INDEX IX_TaskRel_Workspace  ON dbo.TaskRelationships (WorkspaceId);
END
GO

-- Extend CK_CustomFields_Type to allow the two new field types. The CHECK list
-- below is the EXACT 0030 list with 'relationship' and 'rollup' appended; drop
-- the old constraint (guarded) then re-add. WITH NOCHECK is unnecessary — we are
-- only widening the allowed set, so all existing rows still satisfy it.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CustomFields_Type')
    ALTER TABLE dbo.CustomFields DROP CONSTRAINT CK_CustomFields_Type;
GO
ALTER TABLE dbo.CustomFields ADD CONSTRAINT CK_CustomFields_Type CHECK (Type IN (
    'text','text_area','number','currency','checkbox','date','url','email','phone',
    'dropdown','labels','rating','people','progress_manual','progress_auto',
    'relationship','rollup'));
GO
