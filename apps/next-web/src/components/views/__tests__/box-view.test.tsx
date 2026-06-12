import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { BoxView } from '../box-view';
import type { SavedView } from '@projectflow/types';
import type { ViewTaskPageResult } from '@/server/queries/views';

const view = { id: 'v1', type: 'box', config: { filter: { conjunction: 'AND', rules: [] }, sort: [] } } as unknown as SavedView;

const taskPage: ViewTaskPageResult = {
  total: 3,
  groups: [],
  tasks: [
    { id: 't1', title: 'A', status: 'To Do', priority: 'MEDIUM', assignees: [{ userId: 'u1', name: 'Alice', email: 'a@x', avatarUrl: null }] },
    { id: 't2', title: 'B', status: 'To Do', priority: 'LOW',    assignees: [{ userId: 'u1', name: 'Alice', email: 'a@x', avatarUrl: null }] },
    { id: 't3', title: 'C', status: 'Done',  priority: 'HIGH',   assignees: [{ userId: 'u2', name: 'Bob',   email: 'b@x', avatarUrl: null }] },
  ] as any,
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BoxView taskPage={taskPage} activeView={view} />
    </NextIntlClientProvider>,
  );
}

describe('BoxView', () => {
  it('renders one swimlane per assignee', () => {
    renderView();
    expect(screen.getByTestId('box-lane-u1')).toBeInTheDocument();
    expect(screen.getByTestId('box-lane-u2')).toBeInTheDocument();
  });

  it('shows the per-assignee card count', () => {
    renderView();
    expect(screen.getByTestId('box-lane-u1')).toHaveAttribute('data-count', '2');
    expect(screen.getByTestId('box-lane-u2')).toHaveAttribute('data-count', '1');
  });

  it('renders an Unassigned lane when a task has no assignee', () => {
    const tp = { ...taskPage, tasks: [...taskPage.tasks, { id: 't4', title: 'D', status: 'To Do', priority: 'LOW', assignees: [] }] as any };
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BoxView taskPage={tp} activeView={view} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('box-lane-__unassigned__')).toHaveAttribute('data-count', '1');
  });
});
