-- Migration: 0009_automation.sql
-- Creates the AutomationRules table

CREATE TABLE dbo.AutomationRules (
    Id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    ProjectId       UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Projects(Id) ON DELETE CASCADE,
    Name            NVARCHAR(255)    NOT NULL,
    IsEnabled       BIT              NOT NULL DEFAULT 1,
    TriggerConfig   NVARCHAR(MAX)    NOT NULL, -- JSON: { type, config }
    ConditionConfig NVARCHAR(MAX)    NOT NULL, -- JSON: [] of conditions
    ActionConfig    NVARCHAR(MAX)    NOT NULL, -- JSON: [] of actions
    ExecutionCount  INT              NOT NULL DEFAULT 0,
    LastExecutedAt  DATETIME2        NULL,
    CreatedAt       DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt       DATETIME2        NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_AutomationRule_Project ON dbo.AutomationRules(ProjectId);
CREATE INDEX IX_AutomationRule_Enabled  ON dbo.AutomationRules(IsEnabled) WHERE IsEnabled = 1;
