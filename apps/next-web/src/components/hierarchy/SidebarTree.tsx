'use client';

import { useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronRight, ChevronDown, Plus, Globe, FileStack } from 'lucide-react';
import type { TemplateScopeType } from '@projectflow/types';
import { cn } from '@/lib/utils';
import { HIERARCHY_ICONS } from '@/config/hierarchy.config';
import type { Project, Folder, List } from '@/server/queries/normalize';
import {
  createFolder, createList, renameFolder, renameList,
  deleteFolder, deleteList, moveList,
} from '@/server/actions/hierarchy';
import { midpoint } from '@/components/Board';
import { ListNode } from './SidebarTreeNode';
import { SaveAsTemplateModal } from '@/components/templates/SaveAsTemplateModal';

export interface HierarchyTreeData {
  workspaceId: string;
  spaces: Project[];
  foldersBySpace: Record<string, Folder[]>;
  listsBySpace: Record<string, List[]>;
}

const SpaceIcon = HIERARCHY_ICONS.space;
const FolderIcon = HIERARCHY_ICONS.folder;

type Adding = { kind: 'folder' | 'list'; spaceId: string; folderId: string | null } | null;

export function SidebarTree({ data }: { data: HierarchyTreeData }) {
  const t = useTranslations('Hierarchy');
  const tt = useTranslations('Templates');
  const [, startTransition] = useTransition();
  // When the current route is a List page, reveal that list in the tree by
  // seeding the expanded set with its ancestry (space + folder). Client-only
  // expand/collapse state is otherwise lost on a full reload, which would
  // leave the active list hidden inside a collapsed space/folder.
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const seed = new Set<string>();
    const activeListId = pathname?.match(/^\/lists\/([^/?#]+)/)?.[1] ?? null;
    if (activeListId) {
      for (const [spaceId, lists] of Object.entries(data.listsBySpace)) {
        const found = lists.find((l) => l.id === activeListId);
        if (found) {
          seed.add(spaceId);
          if (found.folderId) seed.add(found.folderId);
          break;
        }
      }
    }
    return seed;
  });
  const [adding, setAdding] = useState<Adding>(null);
  const [addName, setAddName] = useState('');
  // "Save as template" target for the shared modal (null = closed).
  const [tplTarget, setTplTarget] = useState<{ scopeType: TemplateScopeType; id: string; name: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Adding a child reveals an inline input that is rendered inside the
  // container's (collapsed-by-default) body, so the container MUST be
  // expanded for the input to mount. Auto-expand on add.
  const expand = (id: string) =>
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  function run(p: Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await p;
      if (!res.ok) console.error('hierarchy action failed:', res.error);
    });
  }

  function submitAdd() {
    const name = addName.trim();
    const a = adding;
    setAdding(null);
    setAddName('');
    if (!name || !a) return;
    if (a.kind === 'folder') run(createFolder({ workspaceId: data.workspaceId, spaceId: a.spaceId, parentFolderId: a.folderId, name }));
    else run(createList({ workspaceId: data.workspaceId, spaceId: a.spaceId, folderId: a.folderId, name }));
  }

  const addInput = (
    <input
      data-testid="node-name-input"
      autoFocus
      value={addName}
      onChange={(e) => setAddName(e.target.value)}
      onBlur={submitAdd}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submitAdd();
        if (e.key === 'Escape') { setAdding(null); setAddName(''); }
      }}
      className="w-full h-7 bg-transparent outline-none border-b border-primary text-[13px] ps-6"
      placeholder={t('namePlaceholder')}
    />
  );

  // Workspace-wide "Everything" views surface. EVERYTHING views have no hierarchy
  // node, so the route carries the workspaceId in the [scopeId] segment; the views
  // page maps it back to a null node scope + workspaceId for the fail-closed
  // EVERYTHING read path.
  const everythingHref = `/views/EVERYTHING/${data.workspaceId}`;
  const everythingActive = pathname?.startsWith('/views/EVERYTHING/') ?? false;

  return (
    <div className="space-y-1">
      <Link
        href={everythingHref}
        data-testid="everything-nav"
        aria-current={everythingActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-1 h-8 px-1 text-sm font-medium rounded hover:bg-muted',
          everythingActive ? 'text-primary bg-muted' : 'text-accent-foreground',
        )}
      >
        {/* Spacer matching the leading chevron toggle on Space/Folder rows so
            the Globe icon and label align with the rows below. */}
        <span className="size-4 shrink-0" aria-hidden="true" />
        <Globe className="size-4 shrink-0 text-muted-foreground" />
        <span className="grow truncate">{t('everything')}</span>
      </Link>

      <div className="uppercase text-xs font-medium text-muted-foreground/70 pt-2 pb-px px-1">
        {t('spaces')}
      </div>
      {data.spaces.map((space) => {
        const folders = data.foldersBySpace[space.id] ?? [];
        const lists = data.listsBySpace[space.id] ?? [];
        const folderless = lists.filter((l) => !l.folderId);
        const open = expanded.has(space.id);
        return (
          <SpaceBlock
            key={space.id}
            space={space}
            open={open}
            onToggle={() => toggle(space.id)}
            onAddFolder={() => { expand(space.id); setAdding({ kind: 'folder', spaceId: space.id, folderId: null }); setAddName(''); }}
            onAddList={() => { expand(space.id); setAdding({ kind: 'list', spaceId: space.id, folderId: null }); setAddName(''); }}
            onSaveTemplate={() => setTplTarget({ scopeType: 'SPACE', id: space.id, name: space.name })}
          >
            {adding?.spaceId === space.id && adding.folderId === null && addInput}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e: DragEndEvent) => onListDragEnd(e, space.id, lists, run)}
            >
              <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                {folders.map((folder) => {
                  const fOpen = expanded.has(folder.id);
                  const folderLists = lists.filter((l) => l.folderId === folder.id);
                  return (
                    <div key={folder.id}>
                      <div
                        data-testid="folder-node"
                        className="group flex items-center gap-1 h-8 ps-4 pe-2 text-[13px] rounded hover:bg-muted"
                      >
                        <button type="button" onClick={() => toggle(folder.id)} className="text-muted-foreground">
                          {fOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        </button>
                        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span
                          className="grow truncate"
                          onDoubleClick={() => {
                            const n = window.prompt(t('renameFolder'), folder.name);
                            if (n && n.trim() && n !== folder.name) run(renameFolder(folder.id, n.trim()));
                          }}
                        >
                          {folder.name}
                        </span>
                        <button
                          type="button" aria-label={tt('saveAsTemplate')} title={tt('saveAsTemplate')}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                          onClick={() => setTplTarget({ scopeType: 'FOLDER', id: folder.id, name: folder.name })}
                        >
                          <FileStack className="size-3.5" />
                        </button>
                        <button
                          type="button" data-testid="list-add" aria-label={t('addList')}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                          onClick={() => { expand(folder.id); setAdding({ kind: 'list', spaceId: space.id, folderId: folder.id }); setAddName(''); }}
                        >
                          <Plus className="size-3.5" />
                        </button>
                        <button
                          type="button" aria-label={t('deleteFolder')}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                          onClick={() => run(deleteFolder(folder.id))}
                        >
                          ×
                        </button>
                      </div>
                      {fOpen && (
                        <>
                          {adding?.spaceId === space.id && adding.folderId === folder.id && addInput}
                          {folderLists.map((l) => (
                            <ListNode key={l.id} list={l} onRename={(id, n) => run(renameList(id, n))} onDelete={(id) => run(deleteList(id))} onSaveTemplate={(id, n) => setTplTarget({ scopeType: 'LIST', id, name: n })} />
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
                {folderless.map((l) => (
                  <ListNode key={l.id} list={l} onRename={(id, n) => run(renameList(id, n))} onDelete={(id) => run(deleteList(id))} onSaveTemplate={(id, n) => setTplTarget({ scopeType: 'LIST', id, name: n })} />
                ))}
              </SortableContext>
            </DndContext>
          </SpaceBlock>
        );
      })}

      {tplTarget && (
        <SaveAsTemplateModal
          open={!!tplTarget}
          onOpenChange={(o) => { if (!o) setTplTarget(null); }}
          scopeType={tplTarget.scopeType}
          sourceId={tplTarget.id}
          defaultName={tplTarget.name}
        />
      )}
    </div>
  );
}

function SpaceBlock({
  space, open, onToggle, onAddFolder, onAddList, onSaveTemplate, children,
}: {
  space: Project; open: boolean; onToggle: () => void;
  onAddFolder: () => void; onAddList: () => void; onSaveTemplate: () => void; children: React.ReactNode;
}) {
  const t = useTranslations('Hierarchy');
  const tt = useTranslations('Templates');
  return (
    <div>
      <div
        data-testid="space-node"
        className="group flex items-center gap-1 h-8 px-1 text-sm font-medium rounded hover:bg-muted"
      >
        <button type="button" onClick={onToggle} className="text-muted-foreground">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <SpaceIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="grow truncate">{space.name}</span>
        <button
          type="button" aria-label={tt('saveAsTemplate')} title={tt('saveAsTemplate')}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
          onClick={onSaveTemplate}
        >
          <FileStack className="size-3.5" />
        </button>
        <button
          type="button" data-testid="folder-add" aria-label={t('addFolder')}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
          onClick={onAddFolder}
        >
          <FolderIcon className="size-3.5" />
        </button>
        <button
          type="button" data-testid="list-add" aria-label={t('addList')}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
          onClick={onAddList}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {open && <div className="mt-px">{children}</div>}
    </div>
  );
}

/** Reorder a list within its current container; recompute Position via midpoint. */
function onListDragEnd(
  e: DragEndEvent,
  spaceId: string,
  lists: List[],
  run: (p: Promise<{ ok: boolean; error?: string }>) => void,
) {
  const { active, over } = e;
  if (!over || active.id === over.id) return;
  const moved = lists.find((l) => l.id === active.id);
  if (!moved) return;
  const siblings = lists.filter((l) => l.folderId === moved.folderId).sort((a, b) => a.position - b.position);
  const overIdx = siblings.findIndex((l) => l.id === over.id);
  if (overIdx === -1) return;
  const prev = siblings[overIdx - 1]?.position ?? null;
  const next = siblings[overIdx]?.position ?? null;
  run(moveList(moved.id, moved.folderId, midpoint(prev, next), spaceId));
}
