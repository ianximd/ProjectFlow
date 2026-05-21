'use client';

import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSelection } from '@/server/actions/selection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Switch handlers: write the cookie; the server re-render is the single source of truth. */
export function useSelectionSwitch() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const switchWorkspace = useCallback((id: string) => {
    // projectId: null clears any project scoped to the previous workspace
    startTransition(async () => { await setSelection({ workspaceId: id, projectId: null }); router.refresh(); });
  }, [router]);
  const switchProject = useCallback((id: string) => {
    startTransition(async () => { await setSelection({ projectId: id }); router.refresh(); });
  }, [router]);
  return { switchWorkspace, switchProject };
}

interface SwitcherProps {
  workspaces: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  activeWorkspaceId: string; activeProjectId: string | null; showProject?: boolean;
}

export function WorkspaceProjectSwitcher({
  workspaces, projects, activeWorkspaceId, activeProjectId, showProject = true,
}: SwitcherProps) {
  const { switchWorkspace, switchProject } = useSelectionSwitch();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {workspaces.length > 1 && (
        <Select value={activeWorkspaceId} onValueChange={switchWorkspace}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Workspace" /></SelectTrigger>
          <SelectContent>{workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {showProject && projects.length > 0 && activeProjectId && (
        <Select value={activeProjectId} onValueChange={switchProject}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}
