import sql from 'mssql';
import { execSpOne } from '../../shared/lib/sqlClient.js';
import type { User } from '@projectflow/types';

export class AuthRepository {
  async createUser(email: string, name: string, passwordHash: string): Promise<User> {
    const rows = await execSpOne<User>('usp_User_Create', [
      { name: 'Email', type: sql.NVarChar(255), value: email },
      { name: 'Name', type: sql.NVarChar(255), value: name },
      { name: 'PasswordHash', type: sql.NVarChar(255), value: passwordHash },
    ]);
    return rows[0];
  }

  async getUserById(userId: string): Promise<User | null> {
    const rows = await execSpOne<User>('usp_User_GetById', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return rows[0] ?? null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const rows = await execSpOne<User>('usp_User_GetByEmail', [
      { name: 'Email', type: sql.NVarChar(255), value: email },
    ]);
    return rows[0] ?? null;
  }

  async updateProfile(
    userId: string,
    fields: { name?: string; avatarUrl?: string | null },
  ): Promise<User | null> {
    // `'avatarUrl' in fields` distinguishes "client did not send the field"
    // (don't touch it) from "client sent null/empty" (clear it).
    const updateAvatar = Object.prototype.hasOwnProperty.call(fields, 'avatarUrl');
    const rows = await execSpOne<User>('usp_User_UpdateProfile', [
      { name: 'UserId',       type: sql.UniqueIdentifier, value: userId },
      { name: 'Name',         type: sql.NVarChar(255),    value: fields.name ?? null },
      { name: 'AvatarUrl',    type: sql.NVarChar(500),    value: fields.avatarUrl ?? null },
      { name: 'UpdateAvatar', type: sql.Bit,              value: updateAvatar ? 1 : 0 },
    ]);
    return rows[0] ?? null;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await execSpOne('usp_User_UpdatePassword', [
      { name: 'UserId',       type: sql.UniqueIdentifier, value: userId },
      { name: 'PasswordHash', type: sql.NVarChar(255),    value: passwordHash },
    ]);
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await execSpOne('usp_RefreshToken_Create', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
      { name: 'TokenHash', type: sql.NVarChar(255), value: tokenHash },
      { name: 'ExpiresAt', type: sql.DateTime2, value: expiresAt },
    ]);
  }

  async getRefreshToken(tokenHash: string): Promise<any | null> {
    const rows = await execSpOne('usp_RefreshToken_Get', [
      { name: 'TokenHash', type: sql.NVarChar(255), value: tokenHash },
    ]);
    return rows[0] ?? null;
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await execSpOne('usp_RefreshToken_Revoke', [
      { name: 'TokenHash', type: sql.NVarChar(255), value: tokenHash },
    ]);
  }

  async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await execSpOne('usp_PasswordReset_Create', [
      { name: 'UserId',    type: sql.UniqueIdentifier, value: userId },
      { name: 'TokenHash', type: sql.NVarChar(255),    value: tokenHash },
      { name: 'ExpiresAt', type: sql.DateTime2,        value: expiresAt },
    ]);
  }

  async consumePasswordResetToken(tokenHash: string, newPasswordHash: string): Promise<{ userId: string } | null> {
    try {
      const rows = await execSpOne<{ UserId: string }>('usp_PasswordReset_Consume', [
        { name: 'TokenHash',    type: sql.NVarChar(255), value: tokenHash },
        { name: 'PasswordHash', type: sql.NVarChar(255), value: newPasswordHash },
      ]);
      return rows[0] ? { userId: rows[0].UserId } : null;
    } catch (err: any) {
      // SP raises descriptive errors for invalid/used/expired tokens
      return null;
    }
  }

  /** Increment failed-login counter; SP sets LockedUntil when threshold reached. */
  async recordFailedLogin(userId: string): Promise<void> {
    await execSpOne('usp_User_RecordFailedLogin', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
  }

  /** Clear failed-login counter and lockout after a successful authentication. */
  async clearLoginAttempts(userId: string): Promise<void> {
    await execSpOne('usp_User_ClearLoginAttempts', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
  }

  // ── MFA ────────────────────────────────────────────────────────────────────

  async getMfaState(userId: string): Promise<{ enabled: boolean; secret: string | null; enabledAt: Date | null } | null> {
    const rows = await execSpOne<{ MfaEnabled: boolean; MfaSecret: string | null; MfaEnabledAt: Date | null }>(
      'usp_User_GetMfaState',
      [{ name: 'UserId', type: sql.UniqueIdentifier, value: userId }],
    );
    const r = rows[0];
    return r ? { enabled: Boolean(r.MfaEnabled), secret: r.MfaSecret, enabledAt: r.MfaEnabledAt } : null;
  }

  async setMfaPending(userId: string, secret: string): Promise<void> {
    await execSpOne('usp_User_SetMfaPending', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
      { name: 'Secret', type: sql.NVarChar(255),    value: secret },
    ]);
  }

  async enableMfa(userId: string): Promise<void> {
    await execSpOne('usp_User_EnableMfa', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
  }

  async disableMfa(userId: string): Promise<void> {
    await execSpOne('usp_User_DisableMfa', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
  }

  async createRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    await execSpOne('usp_MfaRecovery_CreateBatch', [
      { name: 'UserId',     type: sql.UniqueIdentifier, value: userId },
      { name: 'CodeHashes', type: sql.NVarChar(sql.MAX), value: hashes.join('\n') },
    ]);
  }

  async listRecoveryHashes(userId: string): Promise<{ id: string; hash: string }[]> {
    const rows = await execSpOne<{ Id: string; CodeHash: string }>('usp_MfaRecovery_ListHashes', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]);
    return Array.from(rows).map((r) => ({ id: r.Id, hash: r.CodeHash }));
  }

  async consumeRecoveryCode(codeId: string): Promise<boolean> {
    const rows = await execSpOne<{ RowsDeleted: number }>('usp_MfaRecovery_Consume', [
      { name: 'CodeId', type: sql.UniqueIdentifier, value: codeId },
    ]);
    return (rows[0]?.RowsDeleted ?? 0) > 0;
  }
}
