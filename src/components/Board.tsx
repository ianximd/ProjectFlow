import { useState } from 'react';
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

export function Board() {
  const { columns, tasks, moveTask, reorderTasks, addTask, deleteTask } = useStore();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

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

    // Dropping a Task over another Task
    if (isActiveTask && isOverTask) {
      const activeIndex = tasks.findIndex((t) => t.id === activeId);
      const overIndex = tasks.findIndex((t) => t.id === overId);

      const activeTaskData = tasks[activeIndex];
      const overTaskData = tasks[overIndex];

      if (activeTaskData.columnId !== overTaskData.columnId) {
        // Moving to a different column
        moveTask(activeId, overTaskData.columnId);
        
        // Let state update before reordering, or reorder directly:
        const updatedTasks = [...tasks];
        updatedTasks[activeIndex].columnId = overTaskData.columnId;
        reorderTasks(arrayMove(updatedTasks, activeIndex, overIndex));
      } else {
        // Same column reordering
        reorderTasks(arrayMove(tasks, activeIndex, overIndex));
      }
    }

    // Dropping a Task over a empty Column
    if (isActiveTask && isOverColumn) {
      moveTask(activeId, overId);
      
      const activeIndex = tasks.findIndex((t) => t.id === activeId);
      const updatedTasks = [...tasks];
      updatedTasks[activeIndex].columnId = overId;
      
      // Move task to the end of the new column
      const overIndex = tasks.length;
      reorderTasks(arrayMove(updatedTasks, activeIndex, overIndex));
    }
  };

  const onDragEnd = () => {
    setActiveTask(null);
  };

  return (
    <div className={styles.boardContainer}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className={styles.columns}>
          {columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={tasks.filter((task) => task.columnId === col.id)}
              addTask={addTask}
              deleteTask={deleteTask}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className={styles.dragOverlay}>
              <TaskCard task={activeTask} deleteTask={deleteTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
