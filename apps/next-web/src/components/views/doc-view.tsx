'use client';

import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { DOCS_FEATURE_ENABLED } from '@/lib/feature-flags';
import type { SavedView, DocViewConfig } from '@projectflow/types';

interface Props {
  activeView: SavedView;
}

/**
 * Doc view — Phase 9e v1 feature-flagged stub.
 *
 * Phase 7a docs now exist (Phase 7a/7b/7c have landed). A follow-up task can:
 *   1. Flip `DOCS_FEATURE_ENABLED` to `true` in lib/feature-flags.ts.
 *   2. Import and render the real doc reader component here.
 *
 * The stub branch is the only compiled path in this version — the Phase 7
 * component is deliberately NOT imported to keep the bundle lean until the flag
 * is flipped.
 */
export function DocView({ activeView }: Props) {
  const t = useTranslations('Doc');

  const config = activeView.config as DocViewConfig;
  const docId = config.docId ?? null;

  // Flag-gated future path — documented as unreachable TODO until flipped.
  // TODO: when DOCS_FEATURE_ENABLED is true, import and render the Phase 7 doc
  // reader component with `docId`. Do NOT import it here while the flag is false.
  if (DOCS_FEATURE_ENABLED) {
    // Unreachable at compile time while DOCS_FEATURE_ENABLED === false.
    // Placeholder so TypeScript sees the flag usage and doesn't dead-code it.
    return null;
  }

  if (!docId) {
    return (
      <div
        data-testid="view-body-doc"
        data-doc-stub="true"
        className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-background p-8 text-center"
      >
        <div className="space-y-2">
          <FileText className="mx-auto size-8 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">{t('comingSoonTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('noDoc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="view-body-doc"
      data-doc-stub="true"
      data-doc-id={docId}
      className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-background p-8 text-center"
    >
      <div className="space-y-2">
        <FileText className="mx-auto size-8 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">{t('comingSoonTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('comingSoonBody')}</p>
        <p className="text-[11px] font-mono text-muted-foreground/60">{t('pinned')}: {docId}</p>
      </div>
    </div>
  );
}
