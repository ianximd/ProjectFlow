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
}
