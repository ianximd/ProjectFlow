'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import { formatShortDateYear } from '@/lib/date';
import { shiftWeekPeriod } from '@/lib/timesheet-period';
import { submitTimesheet, reviewTimesheet } from '@/server/actions/timesheets';
import { TimesheetGrid } from '@/components/timesheets/timesheet-grid';
import { TimesheetReview } from '@/components/timesheets/timesheet-review';
import { Button } from '@/components/ui/button';
import type { Timesheet, TimesheetAggregate } from '@projectflow/types';

// Date-only period bounds render via noon-anchored ISO so the fixed en-US
// formatter never shifts the day across a timezone (see lib/date.ts).
function fmtDay(dateISO: string): string {
  return formatShortDateYear(`${dateISO}T12:00:00`);
}

export function TimesheetsView({
  timesheet,
  aggregate,
  canApprove,
}: {
  timesheet: Timesheet;
  aggregate: TimesheetAggregate;
  canApprove: boolean;
}) {
  const t = useTranslations('Timesheets');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const period = { periodStart: timesheet.periodStart, periodEnd: timesheet.periodEnd };
  const prev = shiftWeekPeriod(period, -1);
  const next = shiftWeekPeriod(period, 1);

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitTimesheet(timesheet.id);
      if (!res.ok) notifyActionError(res);
      else router.refresh();
    });
  }

  function handleReview(decision: 'approved' | 'rejected') {
    startTransition(async () => {
      const res = await reviewTimesheet(timesheet.id, decision);
      if (!res.ok) notifyActionError(res);
      else router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6" data-testid="timesheets-page" aria-busy={isPending}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Clock className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{t('title')}</div>
          <h2 className="truncate text-base font-semibold text-foreground">{t('heading')}</h2>
        </div>

        {/* Week navigation — periods are Monday→Sunday; ?period= is any day in the week. */}
        <div className="flex items-center gap-1.5">
          <Button asChild size="sm" variant="outline" aria-label={t('prevWeek')}>
            <Link href={`/timesheets?period=${prev.periodStart}`}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <span data-testid="timesheet-period" className="min-w-44 text-center text-xs font-medium text-muted-foreground">
            {fmtDay(period.periodStart)} – {fmtDay(period.periodEnd)}
          </span>
          <Button asChild size="sm" variant="outline" aria-label={t('nextWeek')}>
            <Link href={`/timesheets?period=${next.periodStart}`}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Grid (owner: log + submit) ─────────────────────────────────────── */}
      <TimesheetGrid timesheet={timesheet} aggregate={aggregate} onSubmit={handleSubmit} />

      {/* ── Reviewer panel — only for users with timesheet.approve ─────────── */}
      {canApprove && <TimesheetReview timesheet={timesheet} onReview={handleReview} />}
    </div>
  );
}
