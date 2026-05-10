'use client';

import { useEffect, useRef } from 'react';
import { CommentSection }  from './CommentSection';
import { AttachmentSection } from './AttachmentSection';
import { WorkLogSection }  from './WorkLogSection';
import { PullRequestsSection } from './PullRequestsSection';
import styles from './TaskDrawer.module.css';

interface Task {
  // camelCase (normalized)
  id?: string;
  issueKey?: string;
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  type?: string;
  storyPoints?: number | null;
  dueDate?: string | null;
  // PascalCase (raw from API / SQL Server)
  Id?: string;
  IssueKey?: string;
  Title?: string;
  Description?: string | null;
  Status?: string;
  Priority?: string;
  Type?: string;
  StoryPoints?: number | null;
  DueDate?: string | null;
}

interface Props {
  task: Task | null;
  onClose: () => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  HIGHEST: '#e53e3e',
  HIGH:    '#ed8936',
  MEDIUM:  '#ecc94b',
  LOW:     '#48bb78',
  LOWEST:  '#a0aec0',
};

export function TaskDrawer({ task, onClose }: Props) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!task) return null;

  // Normalize — API returns PascalCase, some callers may use camelCase
  const taskId      = task.Id     ?? task.id     ?? '';
  const issueKey    = task.IssueKey ?? task.issueKey;
  const title       = task.Title  ?? task.title  ?? '(untitled)';
  const description = task.Description ?? task.description;
  const status      = task.Status ?? task.status ?? '';
  const priority    = task.Priority ?? task.priority ?? '';
  const type        = task.Type   ?? task.type   ?? '';
  const storyPoints = task.StoryPoints ?? task.storyPoints;
  const dueDate     = task.DueDate ?? task.dueDate;

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawer} ref={drawerRef} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <span className={styles.issueKey}>{issueKey ?? taskId.slice(0, 8).toUpperCase()}</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <h2 className={styles.title}>{title}</h2>

          <div className={styles.meta}>
            <span className={styles.metaBadge}>{type}</span>
            <span className={styles.metaBadge}>{status}</span>
            <span
              className={styles.metaBadge}
              style={{ color: PRIORITY_COLOR[priority] ?? '#a0aec0' }}
            >
              {priority}
            </span>
            {storyPoints != null && (
              <span className={styles.metaBadge}>{storyPoints} pts</span>
            )}
            {dueDate && (
              <span className={styles.metaBadge}>
                Due {new Date(dueDate).toLocaleDateString()}
              </span>
            )}
          </div>

          {description && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Description</p>
              <p className={styles.description}>{description}</p>
            </div>
          )}

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Attachments</p>
            <AttachmentSection taskId={taskId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Time Tracking</p>
            <WorkLogSection taskId={taskId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Pull Requests & Commits</p>
            <PullRequestsSection taskId={taskId} />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Comments</p>
            <CommentSection taskId={taskId} />
          </div>
        </div>
      </div>
    </>
  );
}
