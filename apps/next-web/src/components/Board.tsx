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
import { useStore } from '../store/useStore';
import type { Task } from '../store/useStore';
import { Column } from './Column';
import { TaskCard } from './TaskCard';
import styles from './Board.module.css';

interface BoardProps {
  initialTasks: any[];
  onMoveTask: (taskId: string, newStatus: string) => void;
  onAddTask: (columnId: string, content: string) => void;
  onDeleteTask: (taskId: string) => void;
  onOpenTask?: (task: any) => void;
}

export function Board({ initialTasks, onMoveTask, onAddTask, onDeleteTask, onOpenTask }: BoardProps) {
  const { columns } = useStore();
  const [tasks, setTasks] = useState<any[]>([]);
  const [activeTask, setActiveTask] = useState<any | null>(null);

  // Sync with remote data
  useEffect(() => {
    if (initialTasks) {
      setTasks(initialTasks);
    }
  }, [initialTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3, // 3px drag start threshold
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const onDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const { data } = active;

    if (data.current?.type === 'Task') {
      setActiveTask(data.current.task);
    }
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const isActiveTask = active.data.current?.type === 'Task';
    const isOverTask = over.data.current?.type === 'Task';
    const isOverColumn = over.data.current?.type === 'Column';

    if (!isActiveTask) return;

    if (isActiveTask && isOverTask) {
      const activeIndex = tasks.findIndex((t) => t.Id === activeId || t.id === activeId);
      const overIndex = tasks.findIndex((t) => t.Id === overId || t.id === overId);

      const activeTaskData = tasks[activeIndex];
      const overTaskData = tasks[overIndex];

      if (activeTaskData.Status !== overTaskData.Status) {
        // Move across columns optimistically — use spread to avoid mutating state directly
        const updatedTasks = tasks.map((t, i) =>
          i === activeIndex ? { ...t, Status: overTaskData.Status, status: overTaskData.Status } : t
        );
        setTasks(arrayMove(updatedTasks, activeIndex, overIndex));
        onMoveTask(activeId as string, overTaskData.Status);
      } else {
        // Same column reordering optimistically
        setTasks(arrayMove(tasks, activeIndex, overIndex));
      }
    }

    if (isActiveTask && isOverColumn) {
      const activeIndex = tasks.findIndex((t) => t.Id === activeId || t.id === activeId);
      if (activeIndex === -1) return;
      const updatedTasks = tasks.map((t, i) =>
        i === activeIndex ? { ...t, Status: overId, status: overId } : t
      );
      setTasks(updatedTasks);
      onMoveTask(activeId as string, overId as string);
    }
  };

  const onDragEnd = () => {
    setActiveTask(null);
  };

  return (
    <div className={styles.boardContainer} role="region" aria-label="Kanban board">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className={styles.columns} role="list" aria-label="Board columns">
          {columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={tasks.filter((task) => task.Status === col.title || task.Status === col.id || task.columnId === col.id)}
              addTask={onAddTask}
              deleteTask={onDeleteTask}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className={styles.dragOverlay}>
              <TaskCard task={activeTask} deleteTask={onDeleteTask} onOpen={onOpenTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
