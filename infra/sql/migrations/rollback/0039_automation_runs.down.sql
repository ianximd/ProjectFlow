-- Rollback 0039: automation runs + usage.
-- Drops AutomationUsage + AutomationRuns. The taxonomy token rewrite is NOT
-- reversed here — it is a one-way, defensive data migration (the legacy engine
-- never fired in prod; all DB work is local-only). Re-running 0039 forward is a
-- no-op on already-renamed rows.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AutomationUsage') DROP TABLE dbo.AutomationUsage;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AutomationRuns')  DROP TABLE dbo.AutomationRuns;
GO
