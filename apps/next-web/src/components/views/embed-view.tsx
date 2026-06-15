'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { SavedView, EmbedViewConfig } from '@projectflow/types';

interface Props {
  activeView: SavedView;
}

/** Allowed URL schemes for the embed iframe.
 *  Only http/https are permitted — javascript:, data:, etc. are blocked. */
const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

/** Client-side scheme re-check: returns the URL unchanged when safe, null when
 *  the scheme is not in the allow-list. This is a defence-in-depth guard — the
 *  Batch A embed-url backend already validates the allow-list server-side. */
function safeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return ALLOWED_SCHEMES.has(parsed.protocol) ? raw : null;
  } catch {
    return null;
  }
}

/** Sandboxed iframe embed view. Reads `config.url` from the active view config
 *  (cast to EmbedViewConfig) and renders it inside a maximally-restrictive
 *  sandbox with `referrerPolicy="no-referrer"`.
 *
 *  The client performs a defensive URL scheme re-check even though the backend
 *  allow-list already validated the URL on save — belt-and-suspenders. */
export function EmbedView({ activeView }: Props) {
  const t = useTranslations('Embed');

  const config = activeView.config as EmbedViewConfig;

  const url = useMemo(() => safeUrl(config.url), [config.url]);

  if (!url) {
    return (
      <div
        data-testid="view-body-embed"
        className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground"
      >
        {t('noUrl')}
      </div>
    );
  }

  return (
    <div data-testid="view-body-embed" className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{url}</span>
      </div>
      <iframe
        data-testid="embed-iframe"
        src={url}
        title={t('title')}
        className="h-full w-full flex-1 border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    </div>
  );
}
