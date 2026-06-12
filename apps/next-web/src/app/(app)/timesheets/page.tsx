import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/server/session';
import { getWorkspaceProjectContext } from '@/server/context';
import {
  getTimesheetForPeriod,
  getTimesheetAggregate,
  canApproveTimesheets,
} from '@/server/queries/timesheets';
import { currentWeekPeriod, weekPeriodOf } from '@/lib/timesheet-period';
import { TimesheetsView } from './timesheets-view';

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireSession();

  const { activeWorkspaceId } = await getWorkspaceProjectContext();
  const sp = await searchParams;
  // ?period= is any day inside the desired week; normalize to its Mon→Sun bounds.
  const period = sp.period ? weekPeriodOf(sp.period) : currentWeekPeriod();

  if (!activeWorkspaceId) {
    const t = await getTranslations('Timesheets');
    return (
      <main className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
        <h1 className="text-base font-semibold text-foreground">{t('heading')}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t('noWorkspace')}</p>
      </main>
    );
  }

  // Get-or-create the caller's envelope for the week, then its aggregate +
  // reviewer-gate in parallel.
  const timesheet = await getTimesheetForPeriod(activeWorkspaceId, period.periodStart, period.periodEnd);
  const [aggregate, canApprove] = await Promise.all([
    getTimesheetAggregate(timesheet.id),
    canApproveTimesheets(activeWorkspaceId),
  ]);

  return <TimesheetsView timesheet={timesheet} aggregate={aggregate} canApprove={canApprove} />;
}
