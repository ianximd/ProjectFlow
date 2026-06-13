-- Rollback 0049: Goals & Targets. Drop in FK order (Targets → Goals → GoalFolders).
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Targets')      DROP TABLE dbo.Targets;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Goals')        DROP TABLE dbo.Goals;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GoalFolders')  DROP TABLE dbo.GoalFolders;
GO
