-- Rollback 0058: Apps / feature toggles.
-- Drops the AppsEnabled overrides table. (The app.manage RBAC slug is owned by
-- 0059_app_perms.sql and reverted by rollback/0059_app_perms.down.sql.)

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AppsEnabled') DROP TABLE dbo.AppsEnabled;
GO
