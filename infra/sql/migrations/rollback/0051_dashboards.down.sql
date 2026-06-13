-- Rollback 0051: Dashboards. Drops DashboardCards then Dashboards.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardCards') DROP TABLE dbo.DashboardCards;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Dashboards')     DROP TABLE dbo.Dashboards;
GO
