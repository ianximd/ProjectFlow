import 'server-only';
import { cache } from 'react';
import { serverFetch } from '../api';

export interface MeProfile {
  id:               string;
  email:            string;
  name:             string;
  avatarUrl:        string | null;
  isEmailVerified:  boolean;
  mfaEnabled:       boolean;
  createdAt:        string | null;
}

/** Fetch the current user's profile. Deduped per render tree. */
export const getMe = cache(async (): Promise<MeProfile> => {
  const r = await serverFetch<any>('/auth/me');
  return {
    id:              String(r?.Id               ?? r?.id               ?? ''),
    email:           String(r?.Email            ?? r?.email            ?? ''),
    name:            String(r?.Name             ?? r?.name             ?? ''),
    avatarUrl:       (r?.AvatarUrl              ?? r?.avatarUrl)       ?? null,
    isEmailVerified: Boolean(r?.IsEmailVerified ?? r?.isEmailVerified),
    mfaEnabled:      Boolean(r?.MfaEnabled      ?? r?.mfaEnabled),
    createdAt:       (r?.CreatedAt              ?? r?.createdAt)       ? String(r?.CreatedAt ?? r?.createdAt) : null,
  };
});
