'use server';

import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ObjectPermissionGrant, ObjectPermissionLevel, HierarchyNodeType } from '@projectflow/types';
import type { ActionResult } from './result';

export async function loadObjectPermissions(objectType: HierarchyNodeType, objectId: string): Promise<ObjectPermissionGrant[]> {
  await requireSession();
  return (await serverFetch<ObjectPermissionGrant[]>(`/access/${objectType}/${objectId}/permissions`)) ?? [];
}

export async function setObjectPermission(
  objectType: HierarchyNodeType, objectId: string,
  input: { subjectType: 'USER' | 'ROLE'; subjectId: string; level: ObjectPermissionLevel },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/access/${objectType}/${objectId}/permissions`, { method: 'PUT', body: JSON.stringify(input) });
  } catch (e) { return toActionError(e); }
  return { ok: true };
}

export async function removeObjectPermission(
  objectType: HierarchyNodeType, objectId: string,
  input: { subjectType: 'USER' | 'ROLE'; subjectId: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/access/${objectType}/${objectId}/permissions`, { method: 'DELETE', body: JSON.stringify(input) });
  } catch (e) { return toActionError(e); }
  return { ok: true };
}
