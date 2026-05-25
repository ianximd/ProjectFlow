-- =============================================================================
-- Migration 0017: Account lockout support
-- Week 25 — Security audit fix cycle
-- =============================================================================
-- Adds FailedLoginCount and LockedUntil columns to the Users table.
-- After 5 consecutive failed logins the account is locked for 15 minutes.
-- A successful login resets both columns.
-- =============================================================================

-- Add columns with safe defaults (idempotent)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'FailedLoginCount'
)
  ALTER TABLE dbo.Users ADD FailedLoginCount INT NOT NULL DEFAULT 0;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'LockedUntil'
)
  ALTER TABLE dbo.Users ADD LockedUntil DATETIME2 NULL;
GO

-- Index: fast lookup of locked accounts (WHERE LockedUntil IS NOT NULL)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_LockedUntil' AND object_id = OBJECT_ID('dbo.Users'))
  CREATE NONCLUSTERED INDEX IX_Users_LockedUntil
    ON dbo.Users (LockedUntil)
    WHERE LockedUntil IS NOT NULL;
GO
