'use client';
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
  onOpenTask?: (task: Task) => void;
}

export function Column({ column, tasks, addTask, deleteTask, onOpenTask }: Props) {
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
    <div className={styles.columnWrapper} role="listitem">
      <div className={styles.columnHeader}>
        <h2 className={styles.title} id={`col-${column.id}`}>{column.title}</h2>
        <span className={styles.count} aria-label={`${tasks.length} issues`}>{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={styles.columnBody}
        role="list"
        aria-labelledby={`col-${column.id}`}
      >
        <SortableContext items={tasks.map((t) => t.Id || t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.Id || task.id} task={task} deleteTask={deleteTask} onOpen={onOpenTask} />
          ))}
        </SortableContext>
        
        {isAdding ? (
          <div className={styles.addCardForm}>
            <label htmlFor={`new-task-${column.id}`} className="sr-only">
              New issue title for {column.title}
            </label>
            <textarea
              id={`new-task-${column.id}`}
              autoFocus
              className={styles.addCardInput}
              placeholder="What needs to be done?"
              value={newTaskContent}
              onChange={(e) => setNewTaskContent(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label={`New issue title for ${column.title}`}
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
            aria-label={`Create issue in ${column.title}`}
          >
            <Plus size={16} aria-hidden="true" />
            Create issue
          </button>
        )}
      </div>
    </div>
  );
}
