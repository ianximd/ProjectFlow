'use client';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../store/useStore';
import styles from './TaskCard.module.css';
import { GripVertical } from 'lucide-react';

interface Props {
  task: Task;
  deleteTask: (id: string | number) => void;
  onOpen?: (task: Task) => void;
}

export function TaskCard({ task, deleteTask, onOpen }: Props) {
  const taskId = task.Id || task.id;

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: taskId,
    data: {
      type: 'Task',
      task,
    },
  });

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  const priority = task.Priority || task.priority || 'MEDIUM';
  const priorityColor =
    priority.toUpperCase() === 'HIGH' ? '#ff5630' : priority.toUpperCase() === 'MEDIUM' ? '#ffab00' : '#36b37e';

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`${styles.card} ${styles.dragging}`}
      />
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={styles.card}>
      <div className={styles.header}>
        <div className={styles.priority} style={{ backgroundColor: priorityColor }} />
        <button
          className={styles.deleteButton}
          onClick={() => deleteTask(taskId)}
        >
          &times;
        </button>
      </div>
      <div
        className={styles.content}
        style={{ cursor: onOpen ? 'pointer' : 'default' }}
        onClick={() => onOpen?.(task)}
      >
        {task.Title || task.content}
      </div>
      <div className={styles.footer}>
        <div className={styles.idBadge}>TSK-{taskId.toString().substring(0, 5)}</div>
        <div
          {...attributes}
          {...listeners}
          className={styles.dragHandle}
        >
          <GripVertical size={16} />
        </div>
      </div>
    </div>
  );
}
