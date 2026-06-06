import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getSavedViews, getViewTasks, getViewWorkflowStatuses, type ViewTaskPageResult } from '@/server/queries/views';
import { getCustomFields } from '@/server/queries/custom-fields';
import type { CustomField, ViewScopeType } from '@projectflow/types';
import { ViewSurface, type LiveScopeProp } from '@/components/views/view-surface';
import { ensureBoardView } from './seed-board-view';

// Mirrors board/page.tsx: gate the session first, then read the (async, Next 16)
// route params + searchParams, run the SSR queries, and hand the data to a client
// component. The (app)/layout.tsx already supplies the app shell (Layout1), so this
// page only renders the surface itself — same as board/page.tsx.

const VALID_SCOPES: readonly ViewScopeType[] = ['LIST', 'FOLDER', 'SPACE', 'EVERYTHING'];

function isViewScopeType(v: string): v is ViewScopeType {
  return (VALID_SCOPES as readonly string[]).includes(v);
}

export default async function ViewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ scopeType: string; scopeId: string }>;
  searchParams: Promise<{ viewId?: string; page?: string; meMode?: string; view?: string }>;
}) {
  await requireSession();

  const { scopeType, scopeId } = await params;
  if (!isViewScopeType(scopeType)) notFound();

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const meMode = Boolean(sp.meMode);

  // EVERYTHING views have no hierarchy node: the route's [scopeId] segment carries
  // the workspaceId instead. Map it to (null node scope + workspaceId) for the
  // fail-closed EVERYTHING read path; scoped views keep their node id and no ws.
  const workspaceId = scopeType === 'EVERYTHING' ? scopeId : undefined;
  const nodeScopeId = scopeType === 'EVERYTHING' ? null : scopeId;

  // Custom fields drive the filter-builder field options + table/list columns.
  // They're only scoped to SPACE/FOLDER/LIST; the EVERYTHING scope has none.
  const customFields: CustomField[] =
    scopeType === 'EVERYTHING' ? [] : await getCustomFields(scopeType, scopeId);

  const views = await getSavedViews(scopeType, nodeScopeId, workspaceId);

  // Seed-on-demand: ?view=board requests the engine Board. If the scope has no
  // board-type saved view yet, create one (idempotent — ensureBoardView no-ops
  // when a board view already exists) and redirect onto it so it becomes active.
  if (sp.view === 'board' && !sp.viewId) {
    const boardViewId = await ensureBoardView(views, scopeType, scopeId, workspaceId);
    if (boardViewId) {
      const qs = new URLSearchParams();
      qs.set('viewId', boardViewId);
      if (meMode) qs.set('meMode', '1');
      redirect(`/views/${scopeType}/${scopeId}?${qs.toString()}`);
    }
  }

  // Active view = explicit ?viewId ?? the default view ?? the first view.
  const requested = sp.viewId ? views.find((v) => v.id === sp.viewId) : undefined;
  const activeView = requested ?? views.find((v) => v.isDefault) ?? views[0] ?? null;

  const taskPage: ViewTaskPageResult | null = activeView
    ? await getViewTasks(activeView.id, page, meMode)
    : null;

  // For a board view, resolve the scope's effective workflow so the engine Board
  // sources its columns from the workflow (parity with the legacy board). Skip for
  // EVERYTHING — it spans projects (no single workflow) and its read path needs a
  // workspaceId the surface doesn't thread yet; the Board falls back to task-derived
  // columns there.
  const boardWorkflowStatuses =
    activeView?.type === 'board' && scopeType !== 'EVERYTHING'
      ? await getViewWorkflowStatuses(scopeType, scopeId)
      : null;

  // Live-subscription scope for the surface (drives useLiveTasks):
  //   - SPACE       → scopeId IS the owning project (a Space is a project here).
  //   - LIST/FOLDER → the owning Space (project) id. There is no client-reachable
  //                   read that maps a node to its owning Space, so we derive it
  //                   from the SSR task page (every task carries its projectId =
  //                   owning Space id). An EMPTY scope yields no project id → the
  //                   surface skips the subscription until SSR re-seeds with a task.
  //   - EVERYTHING  → workspaceId (cross-project workspace feed).
  // accepts: SPACE/EVERYTHING accept every event; LIST keeps only its own list's
  // created tasks; FOLDER accepts NONE of them (see view-surface's `none` note).
  const live = resolveLiveScope(scopeType, scopeId, workspaceId, taskPage);

  return (
    <ViewSurface
      views={views}
      activeViewId={activeView?.id ?? null}
      scopeType={scopeType}
      scopeId={scopeId}
      workspaceId={workspaceId}
      meMode={meMode}
      taskPage={taskPage}
      customFields={customFields}
      boardWorkflowStatuses={boardWorkflowStatuses}
      live={live}
    />
  );
}

/** Map a view scope to the live-subscription scope + accept kind threaded into
 *  the surface. The owning project (Space) id for node scopes is the first task's
 *  `projectId` on the SSR page (all tasks under a node share the owning Space). */
function resolveLiveScope(
  scopeType: ViewScopeType,
  scopeId: string,
  workspaceId: string | undefined,
  taskPage: ViewTaskPageResult | null,
): LiveScopeProp {
  switch (scopeType) {
    case 'EVERYTHING':
      return { workspaceId, acceptKind: 'all' };
    case 'SPACE':
      return { projectId: scopeId, acceptKind: 'all' };
    case 'LIST':
      return {
        projectId: taskPage?.tasks[0]?.projectId ?? undefined,
        acceptKind: 'list',
        listScopeId: scopeId,
      };
    case 'FOLDER':
      return { projectId: taskPage?.tasks[0]?.projectId ?? undefined, acceptKind: 'none' };
    default:
      return { acceptKind: 'all' };
  }
}
