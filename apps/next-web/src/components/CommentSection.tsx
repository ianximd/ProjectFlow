'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './CommentSection.module.css';

interface Comment {
  id: string;
  authorId: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: string;
  isEdited: boolean;
  createdAt: string;
  reactions?: { emoji: string; count: number }[];
}

interface Props {
  taskId: string;
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

export function CommentSection({ taskId }: Props) {
  const queryClient = useQueryClient();
  const currentUser = useStore((s) => s.user);
  const [newBody, setNewBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: ['comments', taskId],
    queryFn: async () => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`/api/v1/comments?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: !!taskId,
  });

  const addMutation = useMutation({
    mutationFn: async (body: string) => {
      const token = useStore.getState().accessToken;
      const res = await fetch('/api/v1/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ taskId, body }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
      setNewBody('');
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`/api/v1/comments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ body }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = useStore.getState().accessToken;
      await fetch(`/api/v1/comments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
    },
  });

  const reactMutation = useMutation({
    mutationFn: async ({ commentId, emoji }: { commentId: string; emoji: string }) => {
      const token = useStore.getState().accessToken;
      const res = await fetch(`/api/v1/comments/${commentId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ emoji }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
    },
  });

  return (
    <div className={styles.comments}>
      {isLoading ? (
        <p className={styles.empty}>Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className={styles.empty}>No comments yet. Be the first!</p>
      ) : (
        comments.map((c) => (
          <div key={c.id} className={styles.comment}>
            <div className={styles.avatar}>{initials(c.authorName)}</div>
            <div className={styles.commentBody}>
              <div className={styles.commentHeader}>
                <span className={styles.authorName}>{c.authorName || 'Unknown'}</span>
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
                      onClick={() => editMutation.mutate({ id: c.id, body: editBody })}
                      disabled={!editBody.trim() || editMutation.isPending}
                    >
                      Save
                    </button>
                    <button className={styles.actionBtn} onClick={() => setEditingId(null)}>
                      Cancel
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
                          onClick={() => reactMutation.mutate({ commentId: c.id, emoji: r.emoji })}
                        >
                          {r.emoji} {r.count}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={styles.commentActions}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => reactMutation.mutate({ commentId: c.id, emoji: '👍' })}
                    >
                      👍
                    </button>
                    {currentUser?.id === c.authorId && (
                      <>
                        <button
                          className={styles.actionBtn}
                          onClick={() => {
                            setEditingId(c.id);
                            setEditBody(c.body);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className={styles.actionBtn}
                          onClick={() => deleteMutation.mutate(c.id)}
                        >
                          Delete
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
          placeholder="Add a comment…"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && newBody.trim()) {
              e.preventDefault();
              addMutation.mutate(newBody);
            }
          }}
        />
        <button
          className={styles.submitBtn}
          onClick={() => newBody.trim() && addMutation.mutate(newBody)}
          disabled={!newBody.trim() || addMutation.isPending}
        >
          {addMutation.isPending ? 'Saving…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
