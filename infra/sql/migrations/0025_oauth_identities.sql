-- =============================================================================
-- Migration 0025: OAuth identities (Phase 1.A — Google sign-in foundation)
-- =============================================================================
-- A user must be able to link multiple OAuth providers (sign in with Google
-- today, link GitHub tomorrow). Columns on Users would force one-provider-
-- per-user or a sparse mess; mirror the satellite-table pattern that
-- MfaRecoveryCodes already uses.
--
-- Token columns are nullable for v1: this is a pure-identity integration.
-- Phase 1.D / future feature work that needs Google Drive etc. will populate
-- AccessTokenEnc / RefreshTokenEnc with AES-256-GCM ciphertext.
--
-- Users.PasswordHash is already nullable (since 0001), so OAuth-only users
-- (no local password) work without altering the parent table.
--
-- Idempotent.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserOAuthIdentities')
BEGIN
    CREATE TABLE dbo.UserOAuthIdentities (
        Id              UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        UserId          UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(Id) ON DELETE CASCADE,
        Provider        NVARCHAR(32)     NOT NULL, -- 'google' | 'github' | 'microsoft' (and future)
        Subject         NVARCHAR(255)    NOT NULL, -- the provider's stable per-user identifier (Google `sub`, Microsoft `oid`, GitHub `id`)
        Email           NVARCHAR(255)    NULL,     -- snapshot at link-time; not authoritative
        AccessTokenEnc  NVARCHAR(MAX)    NULL,     -- reserved for token-persisting features; AES-256-GCM
        RefreshTokenEnc NVARCHAR(MAX)    NULL,
        TokenExpiresAt  DATETIME2        NULL,
        CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_UserOAuthIdentities_Provider_Subject UNIQUE (Provider, Subject)
    );

    CREATE INDEX IX_UserOAuthIdentities_UserId
        ON dbo.UserOAuthIdentities (UserId);
END
GO
