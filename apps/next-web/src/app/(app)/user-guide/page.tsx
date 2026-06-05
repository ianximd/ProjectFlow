import fs from 'node:fs';
import path from 'node:path';
import { BookOpen } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { GuideViewer } from './GuideViewer';

// Server component — reads docs/USER_GUIDE.md from disk at request time so the
// rendered page tracks edits to the source markdown without a rebuild.
async function loadGuide(): Promise<string> {
  // `next dev` and `next build` are invoked from apps/next-web/, so the docs
  // folder sits two levels up at the repo root. Fall back to cwd-relative for
  // unusual launch contexts.
  const candidates = [
    path.join(process.cwd(), '..', '..', 'docs', 'USER_GUIDE.md'),
    path.join(process.cwd(), 'docs', 'USER_GUIDE.md'),
  ];
  for (const p of candidates) {
    try {
      return await fs.promises.readFile(p, 'utf8');
    } catch { /* try next */ }
  }
  return '# User Guide\n\nGuide source not found at `docs/USER_GUIDE.md`.';
}

export default async function UserGuidePage() {
  const [md, t] = await Promise.all([loadGuide(), getTranslations('UserGuide')]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <BookOpen className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t('helpSection')}</div>
          <h2 className="text-base font-semibold text-foreground truncate">
            {t('heading')}
          </h2>
        </div>
      </div>

      <GuideViewer markdown={md} />
    </div>
  );
}
