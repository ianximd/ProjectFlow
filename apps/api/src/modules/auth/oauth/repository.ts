import sql from 'mssql';
import { execSpOne } from '../../../shared/lib/sqlClient.js';
import type { User } from '@projectflow/types';

export interface OAuthIdentityRow {
  Id:        string;
  UserId:    string;
  Provider:  string;
  Subject:   string;
  Email:     string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
}

export class OAuthRepository {
  async findByProviderSubject(provider: string, subject: string): Promise<OAuthIdentityRow | null> {
    const rows = await execSpOne<OAuthIdentityRow>('usp_UserOAuthIdentity_GetByProviderSubject', [
      { name: 'Provider', type: sql.NVarChar(32),  value: provider },
      { name: 'Subject',  type: sql.NVarChar(255), value: subject  },
    ]);
    return rows[0] ?? null;
  }

  /**
   * Atomically create the Users row + the linked identity row. Throws if
   * Users.Email is already taken (caller's collision check should run
   * first, but the DB is the last line of defence).
   */
  async createUserWithIdentity(input: {
    email:         string;
    name:          string;
    avatarUrl:     string | null;
    emailVerified: boolean;
    provider:      string;
    subject:       string;
  }): Promise<User> {
    const rows = await execSpOne<User>('usp_User_CreateFromOAuth', [
      { name: 'Email',         type: sql.NVarChar(255), value: input.email },
      { name: 'Name',          type: sql.NVarChar(255), value: input.name },
      { name: 'AvatarUrl',     type: sql.NVarChar(500), value: input.avatarUrl },
      { name: 'EmailVerified', type: sql.Bit,           value: input.emailVerified },
      { name: 'Provider',      type: sql.NVarChar(32),  value: input.provider },
      { name: 'Subject',       type: sql.NVarChar(255), value: input.subject },
    ]);
    if (!rows[0]) throw new Error('usp_User_CreateFromOAuth returned no row');
    return rows[0];
  }

  async linkExisting(input: {
    userId:   string;
    provider: string;
    subject:  string;
    email:    string | null;
  }): Promise<OAuthIdentityRow> {
    const rows = await execSpOne<OAuthIdentityRow>('usp_UserOAuthIdentity_LinkExisting', [
      { name: 'UserId',   type: sql.UniqueIdentifier, value: input.userId },
      { name: 'Provider', type: sql.NVarChar(32),     value: input.provider },
      { name: 'Subject',  type: sql.NVarChar(255),    value: input.subject },
      { name: 'Email',    type: sql.NVarChar(255),    value: input.email },
    ]);
    if (!rows[0]) throw new Error('usp_UserOAuthIdentity_LinkExisting returned no row');
    return rows[0];
  }

  async listForUser(userId: string): Promise<OAuthIdentityRow[]> {
    return await execSpOne<OAuthIdentityRow>('usp_UserOAuthIdentity_ListForUser', [
      { name: 'UserId', type: sql.UniqueIdentifier, value: userId },
    ]) as unknown as OAuthIdentityRow[];
  }

  async unlink(userId: string, provider: string): Promise<void> {
    await execSpOne('usp_UserOAuthIdentity_Unlink', [
      { name: 'UserId',   type: sql.UniqueIdentifier, value: userId },
      { name: 'Provider', type: sql.NVarChar(32),     value: provider },
    ]);
  }

  /**
   * Phase 1.D — store encrypted access/refresh tokens for an existing
   * identity, identified by (Provider, Subject) which is the natural key
   * the OAuth callback already has. Refresh-token NULL is preserved on
   * the row (see SP for why — Google doesn't re-issue it).
   *
   * Returns true when the identity row was found and updated; false when
   * there's no matching row (caller never called linkExisting/createUserWithIdentity
   * for this (provider, subject)).
   */
  async upsertTokens(input: {
    provider:        string;
    subject:         string;
    accessTokenEnc:  string | null;
    refreshTokenEnc: string | null;
    tokenExpiresAt:  Date | null;
    tokenKeyVersion: string | null;
  }): Promise<boolean> {
    const rows = await execSpOne<{ RowsAffected: number }>('usp_UserOAuthIdentity_UpsertTokens', [
      { name: 'Provider',        type: sql.NVarChar(32),     value: input.provider },
      { name: 'Subject',         type: sql.NVarChar(255),    value: input.subject  },
      { name: 'AccessTokenEnc',  type: sql.NVarChar(sql.MAX), value: input.accessTokenEnc  },
      { name: 'RefreshTokenEnc', type: sql.NVarChar(sql.MAX), value: input.refreshTokenEnc },
      { name: 'TokenExpiresAt',  type: sql.DateTime2,        value: input.tokenExpiresAt },
      { name: 'TokenKeyVersion', type: sql.NVarChar(16),     value: input.tokenKeyVersion },
    ]);
    return (rows[0]?.RowsAffected ?? 0) > 0;
  }

  // Phase 1.E — token-store rows the maintenance workers operate on.
  // Both queries return the encrypted blobs intact so the worker can
  // decrypt them in app code; the SPs themselves never touch plaintext.

  async listExpiringTokens(withinSeconds: number, limit: number): Promise<TokenStoreRow[]> {
    return await execSpOne<TokenStoreRow>('usp_UserOAuthIdentity_ListExpiringTokens', [
      { name: 'WithinSeconds', type: sql.Int, value: withinSeconds },
      { name: 'Limit',         type: sql.Int, value: limit },
    ]) as unknown as TokenStoreRow[];
  }

  async listByKeyVersion(notMatchingPrimary: string, limit: number): Promise<TokenStoreRow[]> {
    return await execSpOne<TokenStoreRow>('usp_UserOAuthIdentity_ListByKeyVersion', [
      { name: 'PrimaryKeyVersion', type: sql.NVarChar(16), value: notMatchingPrimary },
      { name: 'Limit',             type: sql.Int,          value: limit },
    ]) as unknown as TokenStoreRow[];
  }
}

export interface TokenStoreRow {
  Id:               string;
  UserId:           string;
  Provider:         string;
  Subject:          string;
  AccessTokenEnc:   string | null;
  RefreshTokenEnc:  string | null;
  TokenExpiresAt:   Date | null;
  TokenKeyVersion:  string | null;
}
