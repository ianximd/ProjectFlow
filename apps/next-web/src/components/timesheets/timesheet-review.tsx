'use client';

import { useTranslations } from 'next-intl';
import type { Timesheet } from '@projectflow/types';

interface Props {
  timesheet: Timesheet;
  onReview: (decision: 'approved' | 'rejected') => void;
}

export function TimesheetReview({ timesheet, onReview }: Props) {
  const t = useTranslations('Timesheets');
  const reviewable = timesheet.status === 'submitted';

  return (
    <div data-testid="timesheet-review" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('reviewTitle')}</h3>
        <span data-testid="review-status" className="rounded bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide">
          {t(`status.${timesheet.status}`)}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="review-approve"
          disabled={!reviewable}
          onClick={() => onReview('approved')}
          className="rounded bg-green-600 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {t('approve')}
        </button>
        <button
          type="button"
          data-testid="review-reject"
          disabled={!reviewable}
          onClick={() => onReview('rejected')}
          className="rounded bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {t('reject')}
        </button>
      </div>
    </div>
  );
}
