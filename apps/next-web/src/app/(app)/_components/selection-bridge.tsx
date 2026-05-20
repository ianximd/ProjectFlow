'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { setSelection } from '@/server/actions/selection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Ctx {
  activeWorkspaceId: string; activeProjectId: string | null;
  cookieWorkspaceId: string | null; cookieProjectId: string | null;
  workspaceIds: string[]; projectIds: string[];
}

/** Keep legacy zustand selection in sync with the cookie/server truth until Phase 3. */
export function useSelectionBridge(ctx: Ctx) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject = useStore((s) => s.setCurrentProject);
  const legacyWorkspaceId = useStore((s) => s.currentWorkspaceId);
  const legacyProjectId = useStore((s) => s.currentProjectId);

  useEffect(() => {
    if (ctx.cookieWorkspaceId === null && legacyWorkspaceId && ctx.workspaceIds.includes(legacyWorkspaceId)) {
      const seedProject = legacyProjectId && ctx.projectIds.includes(legacyProjectId) ? legacyProjectId : undefined;
      startTransition(async () => {
        await setSelection({ workspaceId: legacyWorkspaceId, ...(seedProject ? { projectId: seedProject } : {}) });
        router.refresh();
      });
      return;
    }
    if (legacyWorkspaceId !== ctx.activeWorkspaceId) setCurrentWorkspace(ctx.activeWorkspaceId);
    if (ctx.activeProjectId && legacyProjectId !== ctx.activeProjectId) setCurrentProject(ctx.activeProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.activeWorkspaceId, ctx.activeProjectId, ctx.cookieWorkspaceId]);
}

/** Switch handlers: write the cookie (server re-render) + mirror zustand. */
export function useSelectionSwitch() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject = useStore((s) => s.setCurrentProject);
  const switchWorkspace = (id: string) => {
    setCurrentWorkspace(id);
    startTransition(async () => { await setSelection({ workspaceId: id, projectId: null }); router.refresh(); });
  };
  const switchProject = (id: string) => {
    setCurrentProject(id);
    startTransition(async () => { await setSelection({ projectId: id }); router.refresh(); });
  };
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
