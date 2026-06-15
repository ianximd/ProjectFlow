'use server';

import { requireSession } from '../session';
import { serverFetchBody } from '../api';
import { toActionError } from './error';
import type { ShareLink, AccessRequest, ShareObjectType, ObjectPermissionLevel } from '@projectflow/types';
import type { ActionResult } from './result';

// Phase 10c — share/access server actions. The /share + /access endpoints return
// bare `{ link }`/`{ links }`/`{ request }` envelopes (NOT the `{ data }` wrapper),
// so these use `serverFetchBody` (raw body) rather than `serverFetch`.

export async function createShareLink(
  objectType: ShareObjectType, objectId: string, expiresAt?: string | null,
): Promise<ActionResult<ShareLink>> {
  await requireSession();
  try {
    const { link } = await serverFetchBody<{ link: ShareLink }>('/share', {
      method: 'POST',
      body: JSON.stringify({ objectType, objectId, expiresAt: expiresAt ?? null }),
    });
    return { ok: true, data: link };
  } catch (e) { return toActionError(e); }
}

export async function revokeShareLink(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetchBody(`/share/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (e) { return toActionError(e); }
}

export async function listShareLinks(
  objectType: ShareObjectType, objectId: string,
): Promise<ActionResult<ShareLink[]>> {
  await requireSession();
  try {
    const { links } = await serverFetchBody<{ links: ShareLink[] }>(`/share/object/${objectType}/${objectId}`);
    return { ok: true, data: links };
  } catch (e) { return toActionError(e); }
}

export async function requestAccess(
  objectType: ShareObjectType, objectId: string, note?: string,
): Promise<ActionResult<AccessRequest>> {
  await requireSession();
  try {
    const { request } = await serverFetchBody<{ request: AccessRequest }>('/access/request', {
      method: 'POST',
      body: JSON.stringify({ objectType, objectId, note }),
    });
    return { ok: true, data: request };
  } catch (e) { return toActionError(e); }
}

export async function resolveAccessRequest(
  id: string, decision: 'granted' | 'denied', level?: ObjectPermissionLevel,
): Promise<ActionResult<AccessRequest>> {
  await requireSession();
  try {
    const { request } = await serverFetchBody<{ request: AccessRequest }>(`/access/request/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision, level }),
    });
    return { ok: true, data: request };
  } catch (e) { return toActionError(e); }
}
