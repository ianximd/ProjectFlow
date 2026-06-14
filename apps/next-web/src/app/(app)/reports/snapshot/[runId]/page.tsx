import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/server/session';
import { getRunSnapshot } from '@/server/actions/scheduled-reports';

/**
 * Read-only snapshot viewer for a single scheduled-report run. Renders the
 * FROZEN card payloads captured at delivery time — it never re-resolves a card
 * against live data. Reached from the run-history panel
 * (`/reports/snapshot/{runId}?scheduleId={scheduleId}`); the scheduleId is
 * required to authorize + locate the run on the API.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ scheduleId?: string }>;
}) {
  await requireSession();
  const { runId } = await params;
  const { scheduleId } = await searchParams;
  const t = await getTranslations('ScheduledReport');

  if (!scheduleId) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <h1 className="text-lg font-semibold text-foreground">{t('snapshotTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
      </div>
    );
  }

  const r = await getRunSnapshot(scheduleId, runId);
  const snapshot = r.ok ? r.data.snapshot : null;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">{t('snapshotTitle')}</h1>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('readOnly')}</p>
      </div>

      {snapshot && snapshot.cards.length > 0 ? (
        <div className="flex flex-col gap-4">
          {snapshot.cards.map((card) => (
            <section
              key={card.cardId}
              className="rounded-lg border border-border bg-card p-4"
              data-card-type={card.type}
            >
              <h2 className="mb-2 text-sm font-semibold text-foreground">
                {card.title ?? card.type}
              </h2>
              <pre className="overflow-x-auto rounded bg-muted/40 p-3 text-xs text-muted-foreground">
                {JSON.stringify(card.data, null, 2)}
              </pre>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noRuns')}</p>
      )}
    </div>
  );
}
