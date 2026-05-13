/**
 * notifyApiError is the single funnel every page calls when an API
 * request fails. Branching matters: known codes get hand-tailored
 * messages, 401s stay silent (auth flow handles itself), everything
 * else falls back to a generic toast that surfaces the API's own
 * message. Tests pin each branch so a regression in one doesn't
 * silently change the others.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock sonner at module scope. notifyApiError calls toast.error()
// directly — the spy lets us assert title + description per branch.
const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError },
}));

const { notifyApiError } = await import('../apiErrorToast');

beforeEach(() => { mocks.toastError.mockClear(); });
afterEach (() => { vi.clearAllMocks(); });

describe('notifyApiError — known codes', () => {
  it('WORKSPACE_FROZEN → tailored title + description', () => {
    notifyApiError({ error: { code: 'WORKSPACE_FROZEN', message: 'raw API msg' } }, 403);
    expect(mocks.toastError).toHaveBeenCalledOnce();
    const [title, opts] = mocks.toastError.mock.calls[0]!;
    expect(title).toBe('Workspace is frozen');
    expect((opts as { description: string }).description).toMatch(/Writes are temporarily disabled/);
  });

  it('WORKSPACE_SUSPENDED → tailored title (distinct from FROZEN)', () => {
    notifyApiError({ error: { code: 'WORKSPACE_SUSPENDED', message: 'raw' } }, 403);
    expect(mocks.toastError.mock.calls[0]![0]).toBe('Workspace suspended');
  });
});

describe('notifyApiError — generic fallback', () => {
  it('uses the API error message when the code is unknown', () => {
    notifyApiError({ error: { code: 'CONFLICT', message: 'Project key already exists' } }, 409);
    expect(mocks.toastError).toHaveBeenCalledOnce();
    const [title, opts] = mocks.toastError.mock.calls[0]!;
    expect(title).toBe('Something went wrong');
    expect((opts as { description: string }).description).toBe('Project key already exists');
  });

  it('falls back to a default description when the API message is empty', () => {
    notifyApiError({ error: { code: 'BOOM', message: '   ' } }, 500);
    expect((mocks.toastError.mock.calls[0]![1] as { description: string }).description)
      .toMatch(/Please try again/);
  });

  it('toasts even when there is no code on the error body', () => {
    // Some endpoints return { error: { message: '…' } } without a code.
    // The fallback toast should still fire so the user knows something failed.
    notifyApiError({ error: { message: 'Invalid input' } }, 400);
    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect((mocks.toastError.mock.calls[0]![1] as { description: string }).description)
      .toBe('Invalid input');
  });

  it('toasts on a totally empty body too — better noisy than silent', () => {
    notifyApiError(null, 500);
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });
});

describe('notifyApiError — silence rules', () => {
  it('does NOT toast on 401 — auth flow has its own redirect', () => {
    // Crucial: every page polls a few endpoints during silent-refresh.
    // A 401 toast every minute would be unusable.
    notifyApiError({ error: { code: 'UNAUTHORIZED', message: 'Token expired' } }, 401);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('does NOT toast on 401 even with a known code', () => {
    notifyApiError({ error: { code: 'WORKSPACE_FROZEN' } }, 401);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
