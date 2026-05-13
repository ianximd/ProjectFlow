-- =============================================================================
-- Migration 0026: OAuth token-encryption key version (Phase 1.D — hardening)
-- =============================================================================
-- 0025 reserved AccessTokenEnc / RefreshTokenEnc columns for AES-256-GCM
-- ciphertext but didn't track which key encrypted them. Without that we
-- cannot rotate keys without re-encrypting every row in lock-step.
--
-- This migration adds a per-row key id so old rows stay decryptable after a
-- new primary key is introduced. The id is short (matches the env var
-- suffix, e.g. "v1", "v2") and is also embedded in the sealed string itself
-- — the column is the cheap-index version for the rotation worker that
-- will re-encrypt rows whose KeyVersion no longer matches PRIMARY.
--
-- Idempotent.
-- =============================================================================

IF NOT EXISTS (
    SELECT 1
    FROM   sys.columns
    WHERE  object_id = OBJECT_ID('dbo.UserOAuthIdentities')
       AND name      = 'TokenKeyVersion'
)
BEGIN
    ALTER TABLE dbo.UserOAuthIdentities
        ADD TokenKeyVersion NVARCHAR(16) NULL;
END
GO

-- Filtered index — only rows that actually have stored tokens. Lets the
-- rotation worker do `WHERE TokenKeyVersion <> @Primary` cheaply, without
-- the index bloating from the (overwhelming) NULL majority.
IF NOT EXISTS (
    SELECT 1
    FROM   sys.indexes
    WHERE  name      = 'IX_UserOAuthIdentities_TokenKeyVersion'
       AND object_id = OBJECT_ID('dbo.UserOAuthIdentities')
)
BEGIN
    CREATE INDEX IX_UserOAuthIdentities_TokenKeyVersion
        ON dbo.UserOAuthIdentities (TokenKeyVersion)
        WHERE TokenKeyVersion IS NOT NULL;
END
GO
