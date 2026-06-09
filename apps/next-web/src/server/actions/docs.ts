'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import type { ActionResult } from './result';

export async function createDoc(input: {
  workspaceId: string;
  scopeType: 'SPACE' | 'FOLDER' | 'LIST';
  scopeId: string;
  name: string;
  icon?: string;
}): Promise<ActionResult<unknown>> {
  await requireSession();
  try {
    const data = await serverFetch('/docs', { method: 'POST', body: JSON.stringify(input) });
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createDocPage(input: {
  docId: string;
  parentPageId?: string | null;
  title?: string;
  afterPageId?: string | null;
}): Promise<ActionResult<unknown>> {
  await requireSession();
  try {
    const data = await serverFetch('/docs/pages', { method: 'POST', body: JSON.stringify(input) });
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function renameDocPage(pageId: string, title: string): Promise<ActionResult> {
  await requireSession();
  try {
    await serverFetch(`/docs/pages/${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveDocPage(
  pageId: string,
  parentPageId: string | null,
  afterPageId: string | null,
): Promise<ActionResult<unknown>> {
  await requireSession();
  try {
    const data = await serverFetch(`/docs/pages/${encodeURIComponent(pageId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ parentPageId, afterPageId }),
    });
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function listDocVersions(pageId: string): Promise<ActionResult<unknown>> {
  await requireSession();
  try {
    const data = await serverFetch(`/docs/pages/${encodeURIComponent(pageId)}/versions`);
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function restoreDocVersion(
  docId: string,
  pageId: string,
  versionId: string,
): Promise<ActionResult<unknown>> {
  await requireSession();
  try {
    const data = await serverFetch(
      `/docs/pages/${encodeURIComponent(pageId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST', body: '{}' },
    );
    revalidatePath(`/docs/${docId}`);
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createTaskFromSelection(
  pageId: string,
  listId: string,
  title: string,
): Promise<ActionResult<unknown>> {
  await requireSession();
  try {
    const data = await serverFetch(
      `/docs/pages/${encodeURIComponent(pageId)}/create-task`,
      { method: 'POST', body: JSON.stringify({ listId, title }) },
    );
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setDocWiki(docId: string, isWiki: boolean): Promise<ActionResult<unknown>> {
  await requireSession();
  try {
    const data = await serverFetch(`/docs/${encodeURIComponent(docId)}/wiki`, {
      method: 'PUT',
      body: JSON.stringify({ isWiki }),
    });
    revalidatePath(`/docs/${docId}`);
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}
