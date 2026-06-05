import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { Permission } from '@projectflow/types';
import enMessages from '../../../../messages/en.json';

import { PermissionPicker } from '../PermissionPicker';

function renderPicker(props: React.ComponentProps<typeof PermissionPicker>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PermissionPicker {...props} />
    </NextIntlClientProvider>,
  );
}

// Minimal catalog spanning two scopes and two resources so we can exercise
// the scope filter, the resource grouping, and the "select all in group"
// indeterminate state.
const catalog: Permission[] = [
  { id: 'p-task-create', resource: 'task',      action: 'create', slug: 'task.create',      scope: 'WORKSPACE', description: null,             createdAt: '' },
  { id: 'p-task-delete', resource: 'task',      action: 'delete', slug: 'task.delete',      scope: 'WORKSPACE', description: 'Delete tasks',   createdAt: '' },
  { id: 'p-ws-update',   resource: 'workspace', action: 'update', slug: 'workspace.update', scope: 'WORKSPACE', description: null,             createdAt: '' },
  { id: 'p-admin-roles', resource: 'admin',     action: 'roles',  slug: 'admin.roles',      scope: 'SYSTEM',    description: 'Manage roles',   createdAt: '' },
];

describe('PermissionPicker', () => {
  it('renders the scope-filtered catalog grouped by resource', () => {
    renderPicker({
      catalog,
      scope: "WORKSPACE",
      selectedIds: new Set(),
      onChange: () => {},
    });

    // WORKSPACE scope: task + workspace groups visible, admin (SYSTEM) hidden.
    expect(screen.getByLabelText(/^task$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^workspace$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^admin$/i)).not.toBeInTheDocument();

    // Individual permissions inside the task group are rendered.
    expect(screen.getByLabelText('create')).toBeInTheDocument();
    expect(screen.getByLabelText('delete')).toBeInTheDocument();
    // Description text shows under permissions that have one.
    expect(screen.getByText('Delete tasks')).toBeInTheDocument();
  });

  it('shows the empty-state hint when no permission matches the scope', () => {
    renderPicker({
      catalog,
      scope: "SYSTEM",
      selectedIds: new Set(),
      onChange: () => {},
    });

    // Only one SYSTEM permission exists, so the resource group renders.
    // To prove the empty state, swap the catalog to one that has no matches.
    expect(screen.getByLabelText('roles')).toBeInTheDocument();

    renderPicker({
      catalog: [],
      scope: "SYSTEM",
      selectedIds: new Set(),
      onChange: () => {},
    });
    expect(screen.getByText(/No permissions available for this scope/)).toBeInTheDocument();
  });

  it('toggles a single permission in/out of the selected set', async () => {
    const onChange = vi.fn();
    const user     = userEvent.setup();

    renderPicker({
      catalog,
      scope: "WORKSPACE",
      selectedIds: new Set(),
      onChange,
    });

    await user.click(screen.getByLabelText('create'));

    expect(onChange).toHaveBeenCalledOnce();
    const next: Set<string> = onChange.mock.calls[0]![0];
    expect(next).toBeInstanceOf(Set);
    expect([...next]).toEqual(['p-task-create']);
  });

  it('removes an already-selected permission when clicked', async () => {
    const onChange = vi.fn();
    const user     = userEvent.setup();

    renderPicker({
      catalog,
      scope: "WORKSPACE",
      selectedIds: new Set(['p-task-create', 'p-task-delete']),
      onChange,
    });

    await user.click(screen.getByLabelText('create'));

    const next: Set<string> = onChange.mock.calls[0]![0];
    expect([...next]).toEqual(['p-task-delete']);
  });

  it('group checkbox selects every permission in the resource at once', async () => {
    const onChange = vi.fn();
    const user     = userEvent.setup();

    renderPicker({
      catalog,
      scope: "WORKSPACE",
      selectedIds: new Set(),
      onChange,
    });

    await user.click(screen.getByLabelText(/Toggle all task permissions/));

    const next: Set<string> = onChange.mock.calls[0]![0];
    expect([...next].sort()).toEqual(['p-task-create', 'p-task-delete']);
  });

  it('group checkbox deselects every permission in the resource when already all-checked', async () => {
    const onChange = vi.fn();
    const user     = userEvent.setup();

    renderPicker({
      catalog,
      scope: "WORKSPACE",
      selectedIds: new Set(['p-task-create', 'p-task-delete', 'p-ws-update']),
      onChange,
    });

    await user.click(screen.getByLabelText(/Toggle all task permissions/));

    const next: Set<string> = onChange.mock.calls[0]![0];
    // task perms gone, workspace perm preserved.
    expect([...next]).toEqual(['p-ws-update']);
  });

  it('renders a partial-selection badge with the count', () => {
    renderPicker({
      catalog,
      scope: "WORKSPACE",
      selectedIds: new Set(['p-task-create']),
      onChange: () => {},
    });

    // Partial state: 1 of 2 task perms selected → "1/2" badge appears in the
    // task group header.
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('disables every checkbox when disabled prop is set', () => {
    renderPicker({
      catalog,
      scope: "WORKSPACE",
      selectedIds: new Set(['p-task-create']),
      onChange: () => {},
      disabled: true,
    });

    // Every checkbox in the form is disabled (group toggles + per-perm).
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toBeDisabled();
  });
});
