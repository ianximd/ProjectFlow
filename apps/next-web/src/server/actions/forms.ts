'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { getWorkspaceProjectContext } from '../context';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';
import type { Form, FormSubmission, CreateFormInput, UpdateFormInput } from '@projectflow/types';

export async function createForm(input: CreateFormInput): Promise<ActionResult<Form>> {
  await requireSession();
  let data: Form;
  try {
    data = await serverFetch<Form>('/forms', { method: 'POST', body: JSON.stringify(input) });
  } catch (e) { return toActionError(e); }
  revalidatePath('/forms');
  return { ok: true, data };
}

export async function updateForm(id: string, patch: UpdateFormInput): Promise<ActionResult<Form>> {
  await requireSession();
  let data: Form;
  try {
    data = await serverFetch<Form>(`/forms/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
  } catch (e) { return toActionError(e); }
  revalidatePath('/forms');
  revalidatePath(`/forms/${id}`);
  return { ok: true, data };
}

export async function deleteForm(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/forms/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) { return toActionError(e); }
  revalidatePath('/forms');
  return { ok: true };
}

export async function listForms(): Promise<Form[]> {
  await requireSession();
  const { activeWorkspaceId } = await getWorkspaceProjectContext();
  if (!activeWorkspaceId) return [];
  try {
    const params = new URLSearchParams({ workspaceId: activeWorkspaceId });
    return (await serverFetch<Form[]>(`/forms?${params.toString()}`)) ?? [];
  } catch { return []; }
}

export async function getForm(id: string): Promise<Form | null> {
  await requireSession();
  try {
    return (await serverFetch<Form>(`/forms/${encodeURIComponent(id)}`)) ?? null;
  } catch { return null; }
}

export async function listSubmissions(formId: string): Promise<FormSubmission[]> {
  await requireSession();
  try {
    return (await serverFetch<FormSubmission[]>(`/forms/${encodeURIComponent(formId)}/submissions`)) ?? [];
  } catch { return []; }
}
