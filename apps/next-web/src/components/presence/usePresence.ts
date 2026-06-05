'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useMutation, useSubscription } from '@apollo/client/react';
import {
  PRESENCE_UPDATED,
  PRESENCE_HEARTBEAT,
  PRESENCE_LEAVE,
} from '@/lib/realtime/presence-operations';

export interface Viewer {
  userId: string;
  name: string;
  avatarUrl: string | null;
  typing: boolean;
}

/**
 * Task-detail presence. While the drawer is open this hook:
 *  - subscribes to the per-task viewer set (`presence:updated`),
 *  - heartbeats every ~20s (carrying the latest typing flag),
 *  - re-heartbeats immediately on typing changes via `setTyping`,
 *  - leaves on unmount and when the tab is hidden.
 *
 * The mount heartbeat causes the backend to publish the current snapshot,
 * which is how a freshly-mounted viewer learns who else is present.
 */
export function usePresence(taskId: string) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [beat] = useMutation(PRESENCE_HEARTBEAT);
  const [leave] = useMutation(PRESENCE_LEAVE);
  const typingRef = useRef(false);

  useSubscription<{ presenceUpdated: Viewer[] }>(PRESENCE_UPDATED, {
    variables: { taskId },
    onData: ({ data }) => {
      const v = data.data?.presenceUpdated;
      if (v) setViewers(v);
    },
  });

  const sendBeat = useCallback(
    (typing: boolean) => {
      typingRef.current = typing;
      beat({ variables: { taskId, typing } }).catch(() => {});
    },
    [beat, taskId],
  );

  useEffect(() => {
    sendBeat(false); // mount → snapshot for everyone
    const id = setInterval(() => sendBeat(typingRef.current), 20_000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        leave({ variables: { taskId } }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      leave({ variables: { taskId } }).catch(() => {});
    };
  }, [taskId, sendBeat, leave]);

  return { viewers, setTyping: sendBeat };
}
