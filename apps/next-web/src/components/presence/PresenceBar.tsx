'use client';

import { useTranslations } from 'next-intl';
import type { Viewer } from './usePresence';

/**
 * Compact viewer-avatars + typing indicator strip for the task drawer header.
 * Excludes the current viewer; renders nothing when no one else is present.
 */
export function PresenceBar({
  viewers,
  currentUserId,
}: {
  viewers: Viewer[];
  currentUserId: string | null;
}) {
  const t = useTranslations('Presence');
  const me = (currentUserId ?? '').toLowerCase();
  const others = viewers.filter((v) => v.userId.toLowerCase() !== me);
  if (others.length === 0) return null;
  const typing = others.filter((v) => v.typing);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="flex -space-x-2">
        {others.slice(0, 5).map((v) => (
          <span
            key={v.userId}
            title={v.name}
            className="inline-flex size-6 items-center justify-center rounded-full border bg-muted text-[10px]"
          >
            {v.name?.[0]?.toUpperCase() ?? '?'}
          </span>
        ))}
      </div>
      <span>{t('viewing', { count: others.length })}</span>
      {typing.length > 0 && <span className="italic">{t('typing', { count: typing.length })}</span>}
    </div>
  );
}
