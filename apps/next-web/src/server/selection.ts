import 'server-only';
import { cookies } from 'next/headers';
import { COOKIE } from './cookies';

export interface Selection {
  workspaceId: string | null;
  projectId: string | null;
}

export async function getSelection(): Promise<Selection> {
  const raw = (await cookies()).get(COOKIE.selection)?.value;
  if (!raw) return { workspaceId: null, projectId: null };
  try {
    const v = JSON.parse(raw) as Partial<Selection>;
    return { workspaceId: v.workspaceId ?? null, projectId: v.projectId ?? null };
  } catch {
    return { workspaceId: null, projectId: null };
  }
}
