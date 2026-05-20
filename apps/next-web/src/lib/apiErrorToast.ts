/**
 * Translate well-known API error codes into Sonner toasts.
 *
 * Drop a call to `notifyApiError(json, status)` inside any per-page
 * `api()` helper (or wherever a fetch result is inspected) and the user
 * gets a tailored message for the codes we choose to handle here. Codes
 * we don't know about are ignored — callers keep their existing error
 * surfaces (thrown Errors, banners, etc.).
 *
 * Why per-call instead of a global fetch interceptor: every page already
 * has its own local `api()` helper and React Query mutation pattern.
 * A central interceptor would have to monkey-patch fetch or replace 20
 * helpers at once; this opt-in helper is one import + one line per use.
 */

import { toast } from 'sonner';

type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

const TOAST_FOR_CODE: Record<string, { title: string; description: string }> = {
  // W43 freeze guard — admin temporarily disabled writes on this workspace.
  WORKSPACE_FROZEN: {
    title:       'Workspace is frozen',
    description: 'Writes are temporarily disabled. Ask an admin to unfreeze it.',
  },
  // W43 freeze guard — workspace pulled for compliance/security.
  WORKSPACE_SUSPENDED: {
    title:       'Workspace suspended',
    description: 'This workspace is suspended and cannot accept changes.',
  },
};

export function notifyApiError(json: ApiErrorBody | null | undefined, status: number): void {
  // 401 means the access token has gone stale — the auth bootstrap will
  // silent-refresh or punt to /login. A toast here is noise.
  if (status === 401) return;

  const code = json?.error?.code;
  if (code) {
    const known = TOAST_FOR_CODE[code];
    if (known) {
      toast.error(known.title, { description: known.description });
      return;
    }
  }

  // Generic fallback. Without this, mutations that fail (validation
  // errors, conflicts, server crashes) leave the user with no signal —
  // React Query swallows the throw and the optimistic UI silently
  // rolls back.
  const message = json?.error?.message?.trim();
  toast.error('Something went wrong', {
    description: message && message.length > 0
      ? message
      : 'The request failed. Please try again.',
  });
}

/** Surface a failed Server Action result as a toast, preserving the backend code. */
export function notifyActionError(res: { error: string; code?: string; status?: number }): void {
  notifyApiError({ error: { code: res.code, message: res.error } }, res.status ?? 0);
}
