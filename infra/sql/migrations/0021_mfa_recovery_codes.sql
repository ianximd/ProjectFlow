-- =============================================================================
-- Migration 0021: TOTP MFA — recovery codes table + enrolment timestamp
-- =============================================================================
-- The Users table already has MfaEnabled (BIT) and MfaSecret (NVARCHAR(255))
-- from migration 0001. This migration adds:
--   * MfaEnabledAt column on Users — audit timestamp for when MFA was turned on
--   * dbo.MfaRecoveryCodes table — single-use backup codes (bcrypt-hashed)
--
-- All idempotent.
-- =============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- Users.MfaEnabledAt
-- ────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('dbo.Users') AND name = 'MfaEnabledAt'
)
BEGIN
    ALTER TABLE dbo.Users ADD MfaEnabledAt DATETIME2 NULL;
END
GO


-- ────────────────────────────────────────────────────────────────────────────
-- MfaRecoveryCodes
-- ────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.tables
    WHERE  name = 'MfaRecoveryCodes' AND schema_id = SCHEMA_ID('dbo')
)
CREATE TABLE dbo.MfaRecoveryCodes (
    Id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    UserId    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(Id) ON DELETE CASCADE,
    -- bcrypt hash of the recovery code (cost factor 12, same as PasswordHash).
    -- Codes themselves are never stored in plaintext; the user sees them
    -- exactly once at enrolment.
    CodeHash  NVARCHAR(255) NOT NULL,
    CreatedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE  name = 'IX_MfaRecoveryCodes_UserId'
      AND  object_id = OBJECT_ID('dbo.MfaRecoveryCodes')
)
    CREATE NONCLUSTERED INDEX IX_MfaRecoveryCodes_UserId
        ON dbo.MfaRecoveryCodes (UserId);
GO
