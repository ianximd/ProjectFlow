-- =============================================================================
-- Migration 0039: Automation runs + usage + taxonomy rewrite (Phase 6a)
--   * AutomationRuns  — per-execution audit (status/payload/results/error/depth)
--   * AutomationUsage — per-workspace per-month run counter
--   * Taxonomy rewrite — rename the legacy Jira-style enum tokens inside the
--     TriggerConfig/ConditionConfig/ActionConfig JSON to ClickUp semantics.
-- Idempotent (catalog guards; rewrite is token-bounded), GO-batched.
-- Rollback in rollback/0039_automation_runs.down.sql.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AutomationRuns')
BEGIN
    CREATE TABLE dbo.AutomationRuns (
        Id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        RuleId        UNIQUEIDENTIFIER NOT NULL,
        WorkspaceId   UNIQUEIDENTIFIER NOT NULL,
        ProjectId     UNIQUEIDENTIFIER NULL,
        TriggerType   NVARCHAR(40)     NOT NULL,
        Status        NVARCHAR(16)     NOT NULL,   -- success|partial|failed|skipped|loop_blocked
        Payload       NVARCHAR(MAX)    NULL,
        ActionResults NVARCHAR(MAX)    NULL,
        Error         NVARCHAR(MAX)    NULL,
        Depth         INT              NOT NULL DEFAULT 0,
        StartedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        FinishedAt    DATETIME2        NULL,
        DurationMs    INT              NULL,
        CONSTRAINT FK_AutomationRuns_Rule
            FOREIGN KEY (RuleId) REFERENCES dbo.AutomationRules(Id) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_AutomationRuns_Rule' AND object_id = OBJECT_ID('dbo.AutomationRuns'))
    CREATE INDEX IX_AutomationRuns_Rule ON dbo.AutomationRuns (RuleId, StartedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_AutomationRuns_Workspace' AND object_id = OBJECT_ID('dbo.AutomationRuns'))
    CREATE INDEX IX_AutomationRuns_Workspace ON dbo.AutomationRuns (WorkspaceId, StartedAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AutomationUsage')
BEGIN
    CREATE TABLE dbo.AutomationUsage (
        WorkspaceId UNIQUEIDENTIFIER NOT NULL,
        Period      CHAR(6)          NOT NULL,   -- 'YYYYMM'
        RunCount    INT              NOT NULL DEFAULT 0,
        CONSTRAINT PK_AutomationUsage PRIMARY KEY (WorkspaceId, Period)
    );
END
GO

-- ── Taxonomy rewrite (folded into 6a; idempotent — bounded to rows with an old token) ──
-- Triggers: ISSUE_CREATED→TASK_CREATED, ISSUE_UPDATED→TASK_UPDATED,
--           ISSUE_TRANSITIONED→STATUS_CHANGED, DUE_DATE_APPROACHING→DUE_DATE_PASSED.
-- Actions:  TRANSITION_ISSUE→CHANGE_STATUS, ASSIGN_ISSUE→ASSIGN,
--           UNASSIGN_ISSUE→UNASSIGN, ADD_COMMENT→POST_COMMENT, TRIGGER_WEBHOOK→CALL_WEBHOOK.
-- (Quotes around tokens prevent ISSUE_UPDATED matching inside ISSUE_TRANSITIONED etc.)
UPDATE dbo.AutomationRules
   SET TriggerConfig = REPLACE(REPLACE(REPLACE(REPLACE(TriggerConfig,
         '"ISSUE_CREATED"',        '"TASK_CREATED"'),
         '"ISSUE_UPDATED"',        '"TASK_UPDATED"'),
         '"ISSUE_TRANSITIONED"',   '"STATUS_CHANGED"'),
         '"DUE_DATE_APPROACHING"', '"DUE_DATE_PASSED"')
 WHERE TriggerConfig LIKE '%"ISSUE_CREATED"%'
    OR TriggerConfig LIKE '%"ISSUE_UPDATED"%'
    OR TriggerConfig LIKE '%"ISSUE_TRANSITIONED"%'
    OR TriggerConfig LIKE '%"DUE_DATE_APPROACHING"%';
GO

UPDATE dbo.AutomationRules
   SET ActionConfig = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ActionConfig,
         '"TRANSITION_ISSUE"', '"CHANGE_STATUS"'),
         '"ASSIGN_ISSUE"',     '"ASSIGN"'),
         '"UNASSIGN_ISSUE"',   '"UNASSIGN"'),
         '"ADD_COMMENT"',      '"POST_COMMENT"'),
         '"TRIGGER_WEBHOOK"',  '"CALL_WEBHOOK"')
 WHERE ActionConfig LIKE '%"TRANSITION_ISSUE"%'
    OR ActionConfig LIKE '%"ASSIGN_ISSUE"%'
    OR ActionConfig LIKE '%"UNASSIGN_ISSUE"%'
    OR ActionConfig LIKE '%"ADD_COMMENT"%'
    OR ActionConfig LIKE '%"TRIGGER_WEBHOOK"%';
GO
