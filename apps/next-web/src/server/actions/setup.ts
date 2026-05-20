'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireSession } from '../session';
import { serverFetch } from '../api';
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

export async function bootstrapWorkspace(
  input: { workspaceName: string; projectName: string },
): Promise<ActionResult> {
  await requireSession();
  try {
    const ws = await serverFetch<{ Id?: string; id?: string }>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: input.workspaceName, slug: slugify(input.workspaceName) }),
    });
    const workspaceId = String(ws?.Id ?? ws?.id ?? '');
    await serverFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        name: input.projectName,
        key: keyify(input.projectName),
        type: 'SCRUM',
      }),
    });
    await setSelection({ workspaceId, projectId: null });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : 'Setup failed' };
  }
  return { ok: true };
}
