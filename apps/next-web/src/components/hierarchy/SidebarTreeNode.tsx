'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HIERARCHY_ICONS } from '@/config/hierarchy.config';
import type { List } from '@/server/queries/normalize';

const ListIcon = HIERARCHY_ICONS.list;

/** A single (sortable) List row: link + inline rename + delete. */
export function ListNode({
  list,
  onRename,
  onDelete,
}: {
  list: List;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: list.id });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  function commit() {
    setEditing(false);
    const next = name.trim();
    if (next && next !== list.name) onRename(list.id, next);
    else setName(list.name);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="list-node"
      className="group flex items-center gap-2 h-8 ps-6 pe-2 text-[13px] rounded hover:bg-muted"
      {...attributes}
      {...listeners}
    >
      <ListIcon className="size-3.5 shrink-0 text-muted-foreground" />
      {editing ? (
        <input
          data-testid="node-name-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setName(list.name); setEditing(false); }
          }}
          className="grow bg-transparent outline-none border-b border-primary"
        />
      ) : (
        <>
          <Link href={`/lists/${list.id}`} className="grow truncate" onDoubleClick={() => setEditing(true)}>
            {list.name}
          </Link>
          {!list.isDefault && (
            <button
              type="button"
              aria-label="Delete list"
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.preventDefault(); onDelete(list.id); }}
            >
              ×
            </button>
          )}
        </>
      )}
    </div>
  );
}
