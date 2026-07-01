'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, X } from 'lucide-react';

import { midpoint } from '@/components/Board';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { notifyActionError } from '@/lib/apiErrorToast';
import { createSavedView, deleteSavedView, reorderSavedView } from '@/server/actions/views';
import type { SavedView, ViewScopeType } from '@projectflow/types';

interface Props {
  views: SavedView[];
  activeViewId: string | null;
  scopeType: ViewScopeType;
  scopeId: string;
  /** Workspace id for creating EVERYTHING views (which fail closed without it). */
  workspaceId?: string;
}

export function ViewTabs({ views, activeViewId, scopeType, scopeId, workspaceId }: Props) {
  const t = useTranslations('Views.tabs');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Navigate to a view by setting ?viewId, preserving the other params (mirrors
  // board-view.tsx's writeFiltersToUrl: clone the current params, mutate, replace).
  const selectView = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('viewId', id);
    // A view switch resets paging; meMode is a per-view-surface toggle so keep it.
    params.delete('page');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // dnd reorder: arrayMove to find the dragged tab's TRUE post-move neighbours,
  // then compute a fractional position between them (mirrors SidebarTree +
  // Board.midpoint).  Using arrayMove avoids the "over item as next" bug where
  // repeated reorders converge/misorder.
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ordered = [...views].sort((a, b) => a.position - b.position);
    const oldIndex = ordered.findIndex((v) => v.id === active.id);
    const newIndex = ordered.findIndex((v) => v.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const moved = arrayMove(ordered, oldIndex, newIndex);
    const pos = moved.findIndex((v) => v.id === active.id);
    const prev = moved[pos - 1]?.position ?? null;
    const next = moved[pos + 1]?.position ?? null;
    startTransition(async () => {
      const res = await reorderSavedView(String(active.id), midpoint(prev, next));
      if (!res.ok) { notifyActionError(res); return; }
      router.refresh();
    });
  };

  const onNewView = () => {
    startTransition(async () => {
      const res = await createSavedView({
        scopeType,
        scopeId: scopeType === 'EVERYTHING' ? null : scopeId,
        type: 'list',
        name: t('newViewDefaultName'),
        isShared: true,
        isDefault: false,
        config: { filter: { conjunction: 'AND', rules: [] }, sort: [] },
        workspaceId: scopeType === 'EVERYTHING' ? workspaceId : undefined,
      });
      if (!res.ok) { notifyActionError(res); return; }
      selectView(res.data.id);
    });
  };

  const ordered = [...views].sort((a, b) => a.position - b.position);

  // Delete a view, then move focus off it: navigate to the nearest remaining
  // view (or drop ?viewId entirely if it was the last one) so the surface never
  // renders a dangling tab. Mirrors the confirm-then-refresh DeleteFormButton flow.
  const onDeleteView = (id: string, name: string) => {
    if (!window.confirm(t('deleteViewConfirm', { name }))) return;
    startTransition(async () => {
      const res = await deleteSavedView(id);
      if (!res.ok) { notifyActionError(res); return; }
      if (activeViewId === id) {
        const fallback = ordered.find((v) => v.id !== id);
        if (fallback) {
          selectView(fallback.id);
        } else {
          const params = new URLSearchParams(searchParams.toString());
          params.delete('viewId');
          params.delete('page');
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-1 border-b border-border" role="tablist" aria-label={t('savedViews')}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ordered.map((v) => v.id)} strategy={horizontalListSortingStrategy}>
          {ordered.map((v) => (
            <ViewTab
              key={v.id}
              view={v}
              active={v.id === activeViewId}
              onSelect={() => selectView(v.id)}
              onDelete={() => onDeleteView(v.id, v.name)}
              deleteLabel={t('deleteView', { name: v.name })}
            />
          ))}
        </SortableContext>
      </DndContext>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onNewView}
        data-testid="view-new"
        className="h-8 px-2 text-xs text-muted-foreground"
      >
        <Plus className="size-3.5" /> {t('newView')}
      </Button>
    </div>
  );
}

function ViewTab({
  view,
  active,
  onSelect,
  onDelete,
  deleteLabel,
}: {
  view: SavedView;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Wrapper carries the sortable node + visual tab chrome; the select button
  // holds the drag listeners (so the tab is the drag handle) while the delete
  // affordance — shown only on the active tab — stays outside the listeners so
  // clicking it never starts a drag. Nested buttons would be invalid markup, so
  // both live as siblings inside the wrapper.
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center h-8 rounded-t -mb-px border-b-2 transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        role="tab"
        aria-selected={active}
        data-testid="view-tab"
        data-active={active ? 'true' : undefined}
        onClick={onSelect}
        className="h-full pl-3 pr-1.5 text-xs font-medium whitespace-nowrap"
      >
        {view.name}
      </button>
      {active && (
        <button
          type="button"
          onClick={onDelete}
          data-testid="view-delete"
          aria-label={deleteLabel}
          title={deleteLabel}
          className="mr-1.5 grid place-items-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
