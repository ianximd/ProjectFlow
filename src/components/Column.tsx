import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import type { Task, Column as ColumnType } from '../store/useStore';
import { TaskCard } from './TaskCard';
import styles from './Column.module.css';
import { Plus } from 'lucide-react';
import { useState } from 'react';

interface Props {
  column: ColumnType;
  tasks: Task[];
  addTask: (columnId: string | number, content: string) => void;
  deleteTask: (id: string | number) => void;
}

export function Column({ column, tasks, addTask, deleteTask }: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTaskContent, setNewTaskContent] = useState('');

  const { setNodeRef } = useDroppable({
    id: column.id,
    data: {
      type: 'Column',
      column,
    },
  });

  const handleAddTask = () => {
    if (newTaskContent.trim()) {
      addTask(column.id, newTaskContent.trim());
      setNewTaskContent('');
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTask();
    } else if (e.key === 'Escape') {
      setIsAdding(false);
      setNewTaskContent('');
    }
  };

  return (
    <div className={styles.columnWrapper}>
      <div className={styles.columnHeader}>
        <h2 className={styles.title}>{column.title}</h2>
        <span className={styles.count}>{tasks.length}</span>
      </div>

      <div ref={setNodeRef} className={styles.columnBody}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} deleteTask={deleteTask} />
          ))}
        </SortableContext>
        
        {isAdding ? (
          <div className={styles.addCardForm}>
            <textarea
              autoFocus
              className={styles.addCardInput}
              placeholder="What needs to be done?"
              value={newTaskContent}
              onChange={(e) => setNewTaskContent(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className={styles.addCardActions}>
              <button className={styles.addButton} onClick={handleAddTask}>Add</button>
              <button className={styles.cancelButton} onClick={() => setIsAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button
            className={styles.addCardTrigger}
            onClick={() => setIsAdding(true)}
          >
            <Plus size={16} />
            Create issue
          </button>
        )}
      </div>
    </div>
  );
}
