'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './NotificationBell.module.css';

interface Notification {
  id: string;
  type: string;
  payload: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}

const POLL_INTERVAL = 30_000; // 30 s

function notifLabel(n: Notification): string {
  const p = n.payload;
  switch (n.type) {
    case 'COMMENT_ADDED':
      return `New comment on "${p.taskTitle ?? 'a task'}"`;
    case 'TASK_ASSIGNED':
      return `You were assigned to "${p.taskTitle ?? 'a task'}"`;
    default:
      return n.type.replace(/_/g, ' ').toLowerCase();
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function apiFetch(path: string, init?: RequestInit) {
  const token = useStore.getState().accessToken;
  return fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    credentials: 'include',
  });
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapperRef      = useRef<HTMLDivElement>(null);
  const queryClient     = useQueryClient();

  const { data } = useQuery<{ notifications: Notification[]; unreadCount: number }>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res  = await apiFetch('/api/v1/notifications?pageSize=20');
      const json = await res.json();
      return { notifications: json.data ?? [], unreadCount: json.meta?.unreadCount ?? 0 };
    },
    refetchInterval: POLL_INTERVAL,
    // Only poll when user is logged in
    enabled: !!useStore.getState().accessToken,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount   = data?.unreadCount ?? 0;

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiFetch('/api/v1/notifications/mark-all-read', { method: 'PATCH' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={styles.bellBtn}
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        {/* Bell SVG */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Notifications</span>
            {unreadCount > 0 && (
              <button
                className={styles.markAllBtn}
                onClick={() => markAllRead.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.list}>
            {notifications.length === 0 ? (
              <p className={styles.empty}>No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`${styles.item}${!n.isRead ? ` ${styles.unread}` : ''}`}
                  onClick={() => { if (!n.isRead) markRead.mutate(n.id); }}
                >
                  <div>{!n.isRead ? <span className={styles.dot} /> : <span className={styles.dotEmpty} />}</div>
                  <div className={styles.body}>
                    <p className={styles.notifText}>{notifLabel(n)}</p>
                    <p className={styles.notifMeta}>{timeAgo(n.createdAt)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
