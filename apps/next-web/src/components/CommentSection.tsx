'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSubscription } from '@apollo/client/react';
import { COMMENT_ADDED } from '@/lib/realtime/operations';
import {
  addComment,
  editComment,
  deleteComment,
  reactToComment,
  assignComment,
  resolveComment,
  loadComments,
} from '@/server/actions/comments';
import { loadWorkspaceMembers } from '@/server/actions/members';
import { notifyActionError } from '@/lib/apiErrorToast';
import type { Comment } from '@/server/queries/comments';
import { parseMentionSegments } from '@/lib/mentions';
import { MentionInput, type MentionMember } from './MentionInput';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import styles from './CommentSection.module.css';
import { useTranslations } from 'next-intl';

interface Props {
  taskId: string;
  /** Current viewer's user id — controls edit/delete affordances. */
  currentUserId: string | null;
  /** Workspace id — used to load members for @-mentions and assignment.
   *  May be null when the drawer has no active workspace; mention/assign
   *  affordances simply have no members in that case. */
  workspaceId: string | null;
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

// Map the lightweight commentAdded subscription payload onto the full Comment
// shape, filling defaults for fields the live event doesn't carry. authorName
// is resolved on the next refetch (or stays null until then).
function mapLiveComment(c: {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}): Comment {
  return {
    id: c.id,
    authorId: c.authorId,
    authorName: null,
    authorAvatarUrl: null,
    body: c.body,
    isEdited: false,
    createdAt: c.createdAt,
    reactions: [],
    assignedToId: null,
    resolvedAt: null,
  };
}

export function CommentSection({ taskId, currentUserId, workspaceId, initialComments }: Props) {
  const t = useTranslations('Comments');
  const [comments, setComments] = useState<Comment[]>(initialComments ?? []);
  const [loaded, setLoaded] = useState<boolean>(initialComments != null);
  const [members, setMembers] = useState<MentionMember[]>([]);
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

  // Load workspace members for @-mentions and the assign picker (mirror WatcherControl).
  useEffect(() => {
    if (!workspaceId) { setMembers([]); return; }
    let cancelled = false;
    loadWorkspaceMembers(workspaceId)
      .then((ms) => {
        if (cancelled) return;
        setMembers(ms.map((m) => ({ userId: m.id, name: m.name ?? m.email })));
      })
      .catch(() => { /* leave empty */ });
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Live appends: the backend broadcasts all comment:created events, so filter
  // to this task and de-dupe by id (the author's own comment also arrives via
  // refetch in onAdd).
  useSubscription<{
    commentAdded: { id: string; taskId: string; authorId: string; body: string; createdAt: string };
  }>(COMMENT_ADDED, {
    variables: { taskId },
    onData: ({ data }) => {
      const c = data.data?.commentAdded;
      if (!c || c.taskId !== taskId) return;
      setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, mapLiveComment(c)]));
    },
  });

  const memberName = (userId: string | null | undefined) =>
    members.find((m) => m.userId.toUpperCase() === (userId ?? '').toUpperCase())?.name ?? null;

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

  const onAssign = (commentId: string, assigneeId: string) => start(async () => {
    const r = await assignComment(commentId, assigneeId);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  const onResolve = (commentId: string, resolved: boolean) => start(async () => {
    const r = await resolveComment(commentId, resolved);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  function renderBody(body: string) {
    return parseMentionSegments(body).map((seg, i) =>
      seg.kind === 'mention' ? (
        <span key={i} className="rounded bg-primary/10 px-1 text-primary">@{seg.name}</span>
      ) : (
        <span key={i}>{seg.value}</span>
      ),
    );
  }

  return (
    <div className={styles.comments}>
      {!loaded ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : comments.length === 0 ? (
        <p className={styles.empty}>{t('noCommentsYet')}</p>
      ) : (
        comments.map((c) => (
          <div
            key={c.id}
            className={styles.comment}
            style={c.resolvedAt ? { opacity: 0.5 } : undefined}
          >
            <div className={styles.avatar}>{initials(c.authorName)}</div>
            <div className={styles.commentBody}>
              <div className={styles.commentHeader}>
                <span className={styles.authorName}>{c.authorName || t('unknown')}</span>
                <span className={styles.commentDate}>
                  {c.createdAt ? relativeTime(c.createdAt) : ''}
                </span>
                {c.resolvedAt && (
                  <span className={styles.commentDate}>{t('resolved')}</span>
                )}
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
                    {renderBody(c.body)}
                  </p>
                  {c.assignedToId && (
                    <p className={styles.commentDate}>
                      {t('assignedTo', { name: memberName(c.assignedToId) ?? t('unknown') })}
                    </p>
                  )}
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
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className={styles.actionBtn}>{t('assign')}</button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 p-2">
                        <div className="flex flex-col gap-1">
                          {members.length === 0 && (
                            <span className="px-2 py-1 text-xs text-muted-foreground">
                              {t('noMembers')}
                            </span>
                          )}
                          {members.map((m) => (
                            <Button
                              key={m.userId}
                              variant="ghost"
                              className="justify-start font-normal hover:bg-accent"
                              onClick={() => onAssign(c.id, m.userId)}
                            >
                              {m.name}
                            </Button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <button
                      className={styles.actionBtn}
                      onClick={() => onResolve(c.id, !c.resolvedAt)}
                      disabled={pending}
                    >
                      {c.resolvedAt ? t('reopen') : t('resolve')}
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
        <div style={{ flex: 1 }}>
          <MentionInput
            value={newBody}
            onChange={setNewBody}
            members={members}
            placeholder={t('addCommentPlaceholder')}
            onSubmit={() => newBody.trim() && onAdd(newBody)}
          />
        </div>
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
