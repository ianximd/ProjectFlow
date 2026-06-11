-- Rollback 0042: Forms.
-- Drops FormSubmissions (the child) first, then Forms. Each table's indexes +
-- constraints drop with it.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FormSubmissions') DROP TABLE dbo.FormSubmissions;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Forms')           DROP TABLE dbo.Forms;
GO
