import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/server/session';
import { getSavedViews, getViewTasks, type ViewTaskPageResult } from '@/server/queries/views';
import { getCustomFields } from '@/server/queries/custom-fields';
import type { CustomField, ViewScopeType } from '@projectflow/types';
import { ViewSurface } from '@/components/views/view-surface';
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

  // Custom fields drive the filter-builder field options + table/list columns.
  // They're only scoped to SPACE/FOLDER/LIST; the EVERYTHING scope has none.
  const customFields: CustomField[] =
    scopeType === 'EVERYTHING' ? [] : await getCustomFields(scopeType, scopeId);

  const views = await getSavedViews(scopeType, scopeId);

  // Seed-on-demand: ?view=board requests the engine Board. If the scope has no
  // board-type saved view yet, create one (idempotent — ensureBoardView no-ops
  // when a board view already exists) and redirect onto it so it becomes active.
  if (sp.view === 'board' && !sp.viewId) {
    const boardViewId = await ensureBoardView(views, scopeType, scopeId);
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

  return (
    <ViewSurface
      views={views}
      activeViewId={activeView?.id ?? null}
      scopeType={scopeType}
      scopeId={scopeId}
      meMode={meMode}
      taskPage={taskPage}
      customFields={customFields}
    />
  );
}
