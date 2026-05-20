import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { ApiError } from '../api';
import type { ActionFail } from './result';

/** Rethrow Next control-flow errors (redirect/notFound); otherwise map to an ActionFail
 *  that preserves the backend error code + status so the client can show curated toasts. */
export function toActionError(e: unknown): ActionFail {
  unstable_rethrow(e);
  if (e instanceof ApiError) return { ok: false, error: e.message, code: e.code, status: e.status };
  return { ok: false, error: e instanceof Error ? e.message : 'Request failed' };
}
