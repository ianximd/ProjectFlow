'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

import { CommentSection } from '@/components/CommentSection';
import type { LiveScopeProp } from '@/components/views/view-surface';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { CustomField, SavedView } from '@projectflow/types';

import styles from './chat-view.module.css';

interface Props {
  /** Paged tasks for the active view — supplies the default channel task. */
  taskPage: ViewTaskPageResult | null;
  /** The active saved view — its config may pin a `chatTaskId`. */
  activeView: SavedView;
  /** The scope's custom fields (kept for prop parity with the other surfaces). */
  customFields: CustomField[];
  /** Current viewer id — passed to CommentSection for edit/delete affordances.
   *  Null is tolerated (affordances hidden; posting still works via the cookie). */
  currentUserId?: string | null;
  /** Workspace id — threaded into CommentSection for @-mentions and assignment. */
  workspaceId?: string;
  /** Live-subscription scope (created/updated/deleted), resolved SSR in the page. */
  live: LiveScopeProp;
}

/**
 * Chat view — a channel-style wrapper that reuses {@link CommentSection} (which
 * already streams `comment:created` live, posts through the comment-create path,
 * and renders @-mentions). The channel target is the view config's pinned
 * `chatTaskId`, else the first task in the SSR page; with neither, the surface
 * shows an empty state.
 */
export function ChatView({ taskPage, activeView, currentUserId, workspaceId }: Props) {
  const t = useTranslations('ChatView');

  // Pinned task from config, else the first task in the active page.
  const targetTaskId = useMemo<string | null>(() => {
    const pinned = (activeView.config as { chatTaskId?: string } | undefined)?.chatTaskId;
    if (pinned) return pinned;
    return taskPage?.tasks?.[0]?.id ?? null;
  }, [activeView, taskPage]);

  if (!targetTaskId) {
    return (
      <div data-testid="view-body-chat" className={styles.empty}>
        {t('noChannel')}
      </div>
    );
  }

  const channelTitle =
    taskPage?.tasks?.find((x) => x.id === targetTaskId)?.title || t('channel');

  return (
    <div data-testid="view-body-chat" className={styles.root}>
      <header className={styles.header}># {channelTitle}</header>
      <div className={styles.stream}>
        <CommentSection
          taskId={targetTaskId}
          currentUserId={currentUserId ?? null}
          workspaceId={workspaceId ?? null}
        />
      </div>
    </div>
  );
}
