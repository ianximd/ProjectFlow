'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  addComment,
  editComment,
  deleteComment,
  reactToComment,
  loadComments,
} from '@/server/actions/comments';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { Comment } from '@/server/queries/comments';
import styles from './CommentSection.module.css';
import { useTranslations } from 'next-intl';

interface Props {
  taskId: string;
  /** Current viewer's user id — controls edit/delete affordances. */
  currentUserId: string | null;
  initialComments?: Comment[];
}

function initials(name: string | null | undefined) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function CommentSection({ taskId, currentUserId, initialComments }: Props) {
  const t = useTranslations('Comments');
  const [comments, setComments] = useState<Comment[]>(initialComments ?? []);
  const [loaded, setLoaded] = useState<boolean>(initialComments != null);
  const [pending, start] = useTransition();
  const [newBody, setNewBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const refetch = () => loadComments(taskId).then((rows) => {
    setComments(rows);
    setLoaded(true);
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (taskId) refetch();
  }, [taskId]);

  const onAdd = (body: string) => start(async () => {
    const r = await addComment(taskId, body);
    if (!r.ok) return notifyActionError(r);
    setNewBody('');
    await refetch();
  });

  const onEdit = (id: string, body: string) => start(async () => {
    const r = await editComment(id, body);
    if (!r.ok) return notifyActionError(r);
    setEditingId(null);
    await refetch();
  });

  const onDelete = (id: string) => start(async () => {
    const r = await deleteComment(id);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  const onReact = (commentId: string, emoji: string) => start(async () => {
    const r = await reactToComment(commentId, emoji);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  return (
    <div className={styles.comments}>
      {!loaded ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : comments.length === 0 ? (
        <p className={styles.empty}>{t('noCommentsYet')}</p>
      ) : (
        comments.map((c) => (
          <div key={c.id} className={styles.comment}>
            <div className={styles.avatar}>{initials(c.authorName)}</div>
            <div className={styles.commentBody}>
              <div className={styles.commentHeader}>
                <span className={styles.authorName}>{c.authorName || t('unknown')}</span>
                <span className={styles.commentDate}>
                  {c.createdAt ? relativeTime(c.createdAt) : ''}
                </span>
              </div>

              {editingId === c.id ? (
                <>
                  <textarea
                    className={styles.textarea}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    style={{ minHeight: 60 }}
                  />
                  <div className={styles.commentActions}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => onEdit(c.id, editBody)}
                      disabled={!editBody.trim() || pending}
                    >
                      {t('save')}
                    </button>
                    <button className={styles.actionBtn} onClick={() => setEditingId(null)}>
                      {t('cancel')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className={`${styles.commentText}${c.isEdited ? ` ${styles.edited}` : ''}`}>
                    {c.body}
                  </p>
                  {c.reactions && c.reactions.length > 0 && (
                    <div className={styles.reactions}>
                      {c.reactions.map((r) => (
                        <button
                          key={r.emoji}
                          className={styles.reactionBtn}
                          onClick={() => onReact(c.id, r.emoji)}
                        >
                          {r.emoji} {r.count}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={styles.commentActions}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => onReact(c.id, '👍')}
                    >
                      👍
                    </button>
                    {currentUserId === c.authorId && (
                      <>
                        <button
                          className={styles.actionBtn}
                          onClick={() => {
                            setEditingId(c.id);
                            setEditBody(c.body);
                          }}
                        >
                          {t('edit')}
                        </button>
                        <button
                          className={styles.actionBtn}
                          onClick={() => onDelete(c.id)}
                        >
                          {t('delete')}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ))
      )}

      {/* Add comment form */}
      <div className={styles.form}>
        <textarea
          className={styles.textarea}
          placeholder={t('addCommentPlaceholder')}
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && newBody.trim()) {
              e.preventDefault();
              onAdd(newBody);
            }
          }}
        />
        <button
          className={styles.submitBtn}
          onClick={() => newBody.trim() && onAdd(newBody)}
          disabled={!newBody.trim() || pending}
        >
          {pending ? t('saving') : t('submit')}
        </button>
      </div>
    </div>
  );
}
