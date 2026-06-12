import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { TimesheetReview } from '../timesheet-review';
import type { Timesheet } from '@projectflow/types';

const submitted: Timesheet = {
  id: 't1', workspaceId: 'w1', userId: 'u1', periodStart: '2026-06-01', periodEnd: '2026-06-07',
  status: 'submitted', submittedAt: '2026-06-08T00:00:00.000Z', reviewedById: null, reviewedAt: null, note: null,
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-08T00:00:00.000Z',
};

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

describe('TimesheetReview', () => {
  it('shows the submitted status badge and enabled approve/reject for a submitted sheet', () => {
    wrap(<TimesheetReview timesheet={submitted} onReview={() => {}} />);
    expect(screen.getByTestId('review-status')).toHaveTextContent('Submitted');
    expect(screen.getByTestId('review-approve')).toBeEnabled();
    expect(screen.getByTestId('review-reject')).toBeEnabled();
  });

  it('fires onReview("approved") when approve is clicked', async () => {
    const onReview = vi.fn();
    wrap(<TimesheetReview timesheet={submitted} onReview={onReview} />);
    await userEvent.click(screen.getByTestId('review-approve'));
    expect(onReview).toHaveBeenCalledWith('approved');
  });

  it('disables approve/reject when not submitted', () => {
    wrap(<TimesheetReview timesheet={{ ...submitted, status: 'approved' }} onReview={() => {}} />);
    expect(screen.getByTestId('review-approve')).toBeDisabled();
  });
});
