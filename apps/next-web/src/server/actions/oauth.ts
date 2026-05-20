'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

/**
 * DELETE /auth/oauth/identities/:provider
 * Unlinks a provider from the current user's account.
 *
 * Returns 409 LAST_CREDENTIAL when the provider is the user's only remaining
 * credential — `toActionError` propagates the code+status so `notifyActionError`
 * on the client surfaces the curated message.
 */
export async function disconnectIdentity(provider: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/auth/oauth/identities/${encodeURIComponent(provider)}`, { method: 'DELETE' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/settings/connected-accounts');
  return { ok: true };
}
