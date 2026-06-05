// Shared presentational metadata for notification types.
//
// One source of truth consumed by BOTH the full Inbox page
// (`app/(app)/notifications/notifications-view.tsx`) and the compact topbar
// dropdown preview (`layouts/layout-1/shared/topbar/notifications-sheet.tsx`).
// Keep this purely presentational (icon + tone + i18n key mapping) — no JSX,
// no rendering logic. The full per-row affordances live on the Inbox page.

import {
  Bell, MessageSquare, UserPlus, AtSign, FileText, AlertCircle,
} from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { formatShortDate } from '@/lib/date';

export type InboxT = ReturnType<typeof useTranslations<'Inbox'>>;

export type NotificationTone = 'blue' | 'amber' | 'emerald' | 'violet' | 'slate';

// ── Type → icon + tone + i18n label/summary key mapping ──────────────────────

export const TYPE_META: Record<string, {
  icon: typeof Bell;
  labelKey: string;
  summaryKey: string;
  tone: NotificationTone;
}> = {
  TASK_ASSIGNED:    { icon: UserPlus,      labelKey: 'labelTaskAssigned',    summaryKey: 'summaryTaskAssigned',    tone: 'blue'    },
  COMMENT_ASSIGNED: { icon: MessageSquare, labelKey: 'labelCommentAssigned', summaryKey: 'summaryCommentAssigned', tone: 'blue'    },
  COMMENT_ADDED:    { icon: MessageSquare, labelKey: 'labelCommentAdded',    summaryKey: 'summaryCommentAdded',    tone: 'emerald' },
  MENTION:          { icon: AtSign,        labelKey: 'labelMention',         summaryKey: 'summaryMention',         tone: 'amber'   },
  TASK_UPDATED:     { icon: FileText,      labelKey: 'labelTaskUpdated',     summaryKey: 'summaryTaskUpdated',     tone: 'violet'  },
  TASK_DUE_SOON:    { icon: AlertCircle,   labelKey: 'labelTaskDueSoon',     summaryKey: 'summaryTaskDueSoon',     tone: 'amber'   },
};

export const TONE_BG: Record<NotificationTone, string> = {
  blue:    'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  amber:   'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  violet:  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  slate:   'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export function typeMeta(type: string) {
  return TYPE_META[type] ?? { icon: Bell, labelKey: '', summaryKey: '', tone: 'slate' as const };
}

// ── Relative time ─────────────────────────────────────────────────────────────
// Shared compact relative formatter; takes the localized `Inbox` translator so
// the time-unit strings resolve via next-intl. Older than ~30 days falls back to
// the locale-stable short date (`formatShortDate`) used app-wide.

export function timeAgo(iso: string, t: InboxT): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '';
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60)         return t('timeSeconds', { value: diff });
  if (diff < 3600)       return t('timeMinutes', { value: Math.round(diff / 60) });
  if (diff < 86400)      return t('timeHours',   { value: Math.round(diff / 3600) });
  if (diff < 86400 * 30) return t('timeDays',    { value: Math.round(diff / 86400) });
  return formatShortDate(iso);
}

/** Fallback noun for the {title} arg when a notification has no taskTitle. */
export function summaryFallbackKey(type: string): string {
  switch (type) {
    case 'COMMENT_ADDED':
    case 'TASK_UPDATED':
      return 'fallbackFollowedTask';
    case 'MENTION':
      return 'fallbackDiscussion';
    default:
      return 'fallbackTask';
  }
}
