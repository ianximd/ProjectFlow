import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { TimesheetGrid } from '../timesheet-grid';
import type { Timesheet, TimesheetAggregate } from '@projectflow/types';

const ts: Timesheet = {
  id: 't1', workspaceId: 'w1', userId: 'u1', periodStart: '2026-06-01', periodEnd: '2026-06-07',
  status: 'draft', submittedAt: null, reviewedById: null, reviewedAt: null, note: null,
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
};
const agg: TimesheetAggregate = {
  rows: [{ workDate: '2026-06-02', taskId: 'k1', taskTitle: 'Build', totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 }],
  totals: { totalSeconds: 3600, billableSeconds: 3600, nonBillableSeconds: 0 },
};

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

describe('TimesheetGrid', () => {
  it('renders a row per aggregate entry and a period total', () => {
    wrap(<TimesheetGrid timesheet={ts} aggregate={agg} onSubmit={() => {}} />);
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByTestId('timesheet-total')).toHaveTextContent('1h 0m');
  });
  it('shows the submit button for a draft timesheet', () => {
    wrap(<TimesheetGrid timesheet={ts} aggregate={agg} onSubmit={() => {}} />);
    expect(screen.getByTestId('timesheet-submit')).toBeEnabled();
  });
});
