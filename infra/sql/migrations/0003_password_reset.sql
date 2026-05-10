-- Password Reset Tokens Table
CREATE TABLE PasswordResetTokens (
    Id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    UserId     UNIQUEIDENTIFIER NOT NULL REFERENCES Users(Id),
    TokenHash  NVARCHAR(255) NOT NULL UNIQUE,
    ExpiresAt  DATETIME2 NOT NULL,
    UsedAt     DATETIME2 NULL,
    CreatedAt  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_PasswordResetTokens_TokenHash ON PasswordResetTokens(TokenHash);
