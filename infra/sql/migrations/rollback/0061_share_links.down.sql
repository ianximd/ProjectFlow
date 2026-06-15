-- Rollback 0061: Public Share Links + Access Requests.
-- Drops AccessRequests then ShareLinks (indexes drop with each table).
-- Permission slugs share.create/share.revoke are intentionally left seeded
-- (harmless if the tables return; mirrors how other slice rollbacks keep
-- catalog perms). Remove them here if a clean perm rollback is required.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccessRequests') DROP TABLE dbo.AccessRequests;
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ShareLinks')     DROP TABLE dbo.ShareLinks;
GO
