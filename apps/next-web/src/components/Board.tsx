'use client';

import { useState, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  DragStartEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Column, type BoardColumn } from './Column';
import { TaskCard, type AssigneeRow } from './TaskCard';

type ApiTask = Record<string, any>;

interface BoardProps {
  /**
   * Columns rendered left-to-right. Each column's `id` must match the
   * `Status` field on tasks that belong in it (the workflow status name).
   */
  columns: BoardColumn[];
  initialTasks: ApiTask[];
  /** Pre-bucketed by TaskId — passed straight through to the cards. */
  assigneesByTaskId?: Record<string, AssigneeRow[]>;
  /**
   * Persist the result of a drag. `position` is a fractional index between
   * neighbours; `newStatus` is set when the card landed in a different column
   * (the position SP applies status + position in a single round-trip).
   */
  onReorderTask: (taskId: string, position: number, newStatus: string | null) => void;
  onAddTask:    (columnId: string, content: string) => void;
  onDeleteTask: (taskId: string) => void;
  onOpenTask?:  (task: ApiTask) => void;
}

function getStatus(t: ApiTask): string {
  return String(t.Status ?? t.status ?? '');
}
function getId(t: ApiTask): string {
  return String(t.Id ?? t.id ?? '');
}
function getPosition(t: ApiTask): number {
  const v = Number(t.Position ?? t.position);
  return Number.isFinite(v) ? v : 0;
}

// Fractional indexing: pick a number that sits strictly between the two
// neighbours so we never have to renumber the whole column. Step constant
// is generous so first inserts don't immediately collide.
const STEP = 1024;
export function midpoint(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return STEP;
  if (prev == null)                 return next! - STEP;
  if (next == null)                 return prev + STEP;
  return (prev + next) / 2;
}

export function Board({
  columns,
  initialTasks,
  assigneesByTaskId,
  onReorderTask,
  onAddTask,
  onDeleteTask,
  onOpenTask,
}: BoardProps) {
  const [tasks,      setTasks]      = useState<ApiTask[]>([]);
  const [activeTask, setActiveTask] = useState<ApiTask | null>(null);
  // Track the dragged card's original status so we can detect cross-column
  // moves at drag-end (onDragOver mutates the local Status optimistically).
  const [dragOriginStatus, setDragOriginStatus] = useState<string | null>(null);

  // Sync with remote data whenever the upstream query refreshes
  useEffect(() => {
    if (initialTasks) setTasks(initialTasks);
  }, [initialTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 3px threshold avoids drag-firing on plain clicks (so the card stays clickable).
      activationConstraint: { distance: 3 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'Task') {
      const t = event.active.data.current.task as ApiTask;
      setActiveTask(t);
      setDragOriginStatus(getStatus(t));
    }
  };

  // onDragOver only mutates local UI state; persistence is deferred to
  // onDragEnd so the user can drag through several columns without firing
  // a network round-trip on every cursor crossing.
  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const isActiveTask = active.data.current?.type === 'Task';
    if (!isActiveTask) return;

    const isOverTask   = over.data.current?.type === 'Task';
    const isOverColumn = over.data.current?.type === 'Column';

    if (isOverTask) {
      const activeIndex = tasks.findIndex((t) => getId(t) === active.id);
      const overIndex   = tasks.findIndex((t) => getId(t) === over.id);
      if (activeIndex === -1 || overIndex === -1) return;

      const overStatus = getStatus(tasks[overIndex]);
      const updated = tasks.map((t, i) =>
        i === activeIndex ? { ...t, Status: overStatus, status: overStatus } : t,
      );
      setTasks(arrayMove(updated, activeIndex, overIndex));
    }

    if (isOverColumn) {
      const activeIndex = tasks.findIndex((t) => getId(t) === active.id);
      if (activeIndex === -1) return;
      const newStatus = String(over.id);
      if (getStatus(tasks[activeIndex]) === newStatus) return;
      const updated = tasks.map((t, i) =>
        i === activeIndex ? { ...t, Status: newStatus, status: newStatus } : t,
      );
      setTasks(updated);
    }
  };

  const onDragEnd = () => {
    const dragged = activeTask;
    setActiveTask(null);
    if (!dragged) { setDragOriginStatus(null); return; }

    const taskId  = getId(dragged);
    const idx     = tasks.findIndex((t) => getId(t) === taskId);
    if (idx === -1) { setDragOriginStatus(null); return; }

    const finalStatus = getStatus(tasks[idx]);
    const movedColumn = dragOriginStatus !== null && finalStatus !== dragOriginStatus;

    // Compute fractional position between same-column neighbours in the
    // post-drag local order. arrayMove already rearranged `tasks` so the
    // visual neighbours are also the source of truth here.
    const colTasks = tasks.filter((t) => getStatus(t) === finalStatus);
    const myIdx    = colTasks.findIndex((t) => getId(t) === taskId);
    const prevPos  = myIdx > 0 ? getPosition(colTasks[myIdx - 1]!) : null;
    const nextPos  = myIdx < colTasks.length - 1 ? getPosition(colTasks[myIdx + 1]!) : null;

    // Skip the round-trip if nothing observable changed: same column, same
    // neighbours, original Position is already strictly between them.
    if (!movedColumn) {
      const myPos = getPosition(tasks[idx]);
      const stable =
        (prevPos == null || myPos > prevPos) &&
        (nextPos == null || myPos < nextPos);
      if (stable) { setDragOriginStatus(null); return; }
    }

    onReorderTask(taskId, midpoint(prevPos, nextPos), movedColumn ? finalStatus : null);
    setDragOriginStatus(null);
  };

  return (
    <div
      className="flex h-full w-full flex-col"
      role="region"
      aria-label="Kanban board"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div
          className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-2 snap-x md:snap-none"
          role="list"
          aria-label="Board columns"
        >
          {columns.map((col) => (
            <div key={col.id} className="snap-start">
              <Column
                column={col}
                tasks={tasks.filter((t) => getStatus(t) === col.id || getStatus(t) === col.title)}
                assigneesByTaskId={assigneesByTaskId}
                addTask={onAddTask}
                deleteTask={onDeleteTask}
                onOpenTask={onOpenTask}
              />
            </div>
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className="rotate-2 cursor-grabbing">
              <TaskCard
                task={activeTask}
                assignees={assigneesByTaskId?.[getId(activeTask)]}
                deleteTask={onDeleteTask}
                onOpen={onOpenTask}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
