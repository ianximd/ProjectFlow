import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { WorkloadView } from '../workload-view';
import type { CapacityResult } from '@projectflow/types';

function renderView(capacity: CapacityResult) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <WorkloadView capacity={capacity} />
    </NextIntlClientProvider>,
  );
}

const base: CapacityResult = {
  metric: 'time', from: '2026-06-01', to: '2026-06-05',
  rows: [
    { userId: 'u1', name: 'Alice', email: null, avatarUrl: null, assignedSeconds: 172800, assignedPoints: 0, taskCount: 6, capacity: 144000, status: 'over', ratio: 1.2 },
    { userId: 'u2', name: 'Bob',   email: null, avatarUrl: null, assignedSeconds: 36000,  assignedPoints: 0, taskCount: 1, capacity: 144000, status: 'under', ratio: 0.25 },
  ],
};

describe('WorkloadView', () => {
  it('renders a row per assignee', () => {
    renderView(base);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('flags the over-capacity assignee', () => {
    renderView(base);
    const aliceRow = screen.getByTestId('workload-row-u1');
    expect(aliceRow).toHaveAttribute('data-status', 'over');
    expect(aliceRow.querySelector('[data-testid="over-capacity-badge"]')).not.toBeNull();
  });

  it('does not flag an under-capacity assignee', () => {
    renderView(base);
    const bobRow = screen.getByTestId('workload-row-u2');
    expect(bobRow).toHaveAttribute('data-status', 'under');
    expect(bobRow.querySelector('[data-testid="over-capacity-badge"]')).toBeNull();
  });

  it('renders an empty state when no assignees', () => {
    renderView({ ...base, rows: [] });
    expect(screen.getByTestId('workload-empty')).toBeInTheDocument();
  });
});
