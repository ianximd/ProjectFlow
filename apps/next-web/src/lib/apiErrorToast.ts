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

export function notifyApiError(json: ApiErrorBody | null | undefined, _status: number): void {
  const code = json?.error?.code;
  if (!code) return;
  const entry = TOAST_FOR_CODE[code];
  if (!entry) return;
  toast.error(entry.title, { description: entry.description });
}
