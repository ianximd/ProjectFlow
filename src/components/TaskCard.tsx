import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../store/useStore';
import styles from './TaskCard.module.css';
import { GripVertical } from 'lucide-react';

interface Props {
  task: Task;
  deleteTask: (id: string | number) => void;
}

export function TaskCard({ task, deleteTask }: Props) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: 'Task',
      task,
    },
  });

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  const priorityColor =
    task.priority === 'High' ? '#ff5630' : task.priority === 'Medium' ? '#ffab00' : '#36b37e';

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
          onClick={() => deleteTask(task.id)}
        >
          &times;
        </button>
      </div>
      <div className={styles.content}>{task.content}</div>
      <div className={styles.footer}>
        <div className={styles.idBadge}>TSK-{task.id.toString().substring(0, 3)}</div>
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
