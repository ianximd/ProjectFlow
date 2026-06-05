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
 *  - re-heartbeats on typing-state transitions via `setTyping`,
 *  - leaves on unmount and when the tab is hidden.
 *
 * The mount heartbeat causes the backend to publish the current snapshot,
 * which is how a freshly-mounted viewer learns who else is present.
 *
 * No-op when `taskId` is falsy: the hook is called unconditionally (rules of
 * hooks) from drawers that may have no task yet, so the subscription and every
 * mutation are gated to avoid pointless round-trips that the backend rejects.
 */
export function usePresence(taskId: string) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [beat] = useMutation(PRESENCE_HEARTBEAT);
  const [leave] = useMutation(PRESENCE_LEAVE);
  const typingRef = useRef(false);

  useSubscription<{ presenceUpdated: Viewer[] }>(PRESENCE_UPDATED, {
    variables: { taskId },
    skip: !taskId,
    onData: ({ data }) => {
      const v = data.data?.presenceUpdated;
      if (v) setViewers(v);
    },
  });

  const sendBeat = useCallback(
    (typing: boolean) => {
      typingRef.current = typing;
      if (!taskId) return;
      beat({ variables: { taskId, typing } }).catch(() => {});
    },
    [beat, taskId],
  );

  // Edge-guarded typing signal for the composer: the new-comment composer fires
  // on every keystroke, but the backend only cares about the typing-state flip,
  // so coalesce per-keystroke calls down to the false→true / true→false beats.
  const setTyping = useCallback(
    (typing: boolean) => {
      if (typing === typingRef.current) return;
      sendBeat(typing);
    },
    [sendBeat],
  );

  useEffect(() => {
    if (!taskId) return;
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

  return { viewers, setTyping };
}
