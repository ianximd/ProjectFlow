'use server';
import { requireSession } from '../session';
import { serverFetch } from '../api';
import { toActionError } from './error';
import { setSelection } from './selection';
import type { ActionResult } from './result';

// Append a short random suffix so onboarding never fails on a duplicate slug
// (workspace slug has a UNIQUE constraint; it is editable later in workspace settings).
function slugify(s: string) {
  const base = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function keyify(s: string) {
  return (s.trim().split(/\s+/).map((p) => p[0]).join('') || s.slice(0, 4)).slice(0, 4).toUpperCase();
}

export async function bootstrapWorkspace(input: { workspaceName: string; projectName: string }): Promise<ActionResult> {
  await requireSession();
  let workspaceId = '';
  try {
    const ws = await serverFetch<{ Id?: string; id?: string }>('/workspaces', {
      method: 'POST', body: JSON.stringify({ name: input.workspaceName, slug: slugify(input.workspaceName) }),
    });
    workspaceId = String(ws?.Id ?? ws?.id ?? '');           // API returns PascalCase Id (camelCase fallback)
    if (!workspaceId) return { ok: false, error: 'Workspace created but no ID was returned.' };
    await serverFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name: input.projectName, key: keyify(input.projectName), type: 'SCRUM' }),
    });
  } catch (e) { return toActionError(e); }
  // Best-effort: the workspace + project already exist; a selection-cookie failure must not
  // report failure (a retry would create a duplicate workspace).
  try { await setSelection({ workspaceId, projectId: null }); } catch { /* non-blocking */ }
  return { ok: true };
}
