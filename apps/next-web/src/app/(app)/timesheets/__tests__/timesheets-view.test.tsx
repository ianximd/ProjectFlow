import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../../messages/en.json';
import type { Timesheet, TimesheetAggregate } from '@projectflow/types';

// The view imports the `'use server'` actions module (whose `../session` pulls
// `import 'server-only'`, unresolvable in vitest) and `useRouter` — stub both.
vi.mock('@/server/actions/timesheets', () => ({
  submitTimesheet: vi.fn(),
  reviewTimesheet: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { TimesheetsView } from '../timesheets-view';

const ts: Timesheet = {
  id: 't1', workspaceId: 'w1', userId: 'u1', periodStart: '2026-06-01', periodEnd: '2026-06-07',
  status: 'submitted', submittedAt: '2026-06-07T00:00:00.000Z', reviewedById: null, reviewedAt: null,
  note: null, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
};
const agg: TimesheetAggregate = {
  rows: [{ workDate: '2026-06-02', taskId: 'k1', taskTitle: 'Build', totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 }],
  totals: { totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 },
};

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

describe('TimesheetsView', () => {
  it('renders the grid and the Mon→Sun period range', () => {
    wrap(<TimesheetsView timesheet={ts} aggregate={agg} canApprove={false} />);
    expect(screen.getByTestId('timesheet-grid')).toBeInTheDocument();
    const period = screen.getByTestId('timesheet-period');
    expect(period).toHaveTextContent('Jun 1, 2026');
    expect(period).toHaveTextContent('Jun 7, 2026');
  });

  it('hides the reviewer panel when the user cannot approve', () => {
    wrap(<TimesheetsView timesheet={ts} aggregate={agg} canApprove={false} />);
    expect(screen.queryByTestId('timesheet-review')).not.toBeInTheDocument();
  });

  it('shows the reviewer panel when the user can approve', () => {
    wrap(<TimesheetsView timesheet={ts} aggregate={agg} canApprove />);
    expect(screen.getByTestId('timesheet-review')).toBeInTheDocument();
  });

  it('links week navigation to the adjacent Monday periods', () => {
    wrap(<TimesheetsView timesheet={ts} aggregate={agg} canApprove={false} />);
    // base week Mon 2026-06-01 → prev Mon 2026-05-25, next Mon 2026-06-08.
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/timesheets?period=2026-05-25');
    expect(hrefs).toContain('/timesheets?period=2026-06-08');
  });
});
