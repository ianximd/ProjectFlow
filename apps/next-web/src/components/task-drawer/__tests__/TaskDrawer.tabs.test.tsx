/**
 * TaskDrawer tab-switching test
 *
 * Scope: exercises the tablist / tab / tabpanel ARIA wiring and activeTab
 * state transitions. Heavy sub-components and server actions are stubbed.
 *
 * Note on mock paths: vi.mock paths are resolved by Vite using the same
 * module resolution as the consuming file (TaskDrawer.tsx in src/components/).
 * Relative imports from TaskDrawer use paths like './CommentSection', which
 * Vite resolves to the same module regardless of where the test file lives.
 * We therefore mock by the resolved absolute alias (@/components/...) where
 * possible, or by matching the import string used in TaskDrawer.tsx exactly
 * when the import is a bare relative (Vite normalises to the same id).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../../../messages/en.json';

// ─── Next.js stubs ───────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) =>
    React.createElement('a', { href: typeof href === 'string' ? href : String(href), ...rest }, children),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// ─── Markdown ────────────────────────────────────────────────────────────────
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('remark-gfm', () => ({ default: () => {} }));

// ─── Server actions ───────────────────────────────────────────────────────────
vi.mock('@/server/actions/tasks', () => ({
  updateTaskFields:   vi.fn().mockResolvedValue({ ok: true }),
  updateTaskSchedule: vi.fn().mockResolvedValue({ ok: true }),
  setTaskAssignees:   vi.fn().mockResolvedValue({ ok: true, data: [] }),
  loadTaskTypes:      vi.fn().mockResolvedValue([]),
  loadTaskStatuses:   vi.fn().mockResolvedValue([]),
  transitionTask:     vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/server/actions/members', () => ({
  loadWorkspaceMembers: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/server/actions/auth', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue('user-1'),
}));
vi.mock('@/server/actions/custom-fields', () => ({
  loadTaskCustomFields: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/server/actions/apps', () => ({
  loadAppToggles: vi.fn().mockResolvedValue({ ok: true, data: { apps: [] } }),
}));
vi.mock('@/server/actions/activity', () => ({
  loadTaskActivity: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/appGate', () => ({
  isAppOn: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/apiErrorToast', () => ({
  notifyActionError: vi.fn(),
}));

// ─── Presence ────────────────────────────────────────────────────────────────
vi.mock('@/components/presence/usePresence', () => ({
  usePresence: () => ({ viewers: [], setTyping: () => {} }),
}));
vi.mock('@/components/presence/PresenceBar', () => ({
  PresenceBar: () => null,
}));

// ─── Heavy child components — mocked by their import path as used in TaskDrawer
// TaskDrawer.tsx is in src/components/ and imports these as './Foo'
// vi.mock resolves relative to the consuming module, so we use @/ aliases.
vi.mock('@/components/CommentSection', () => ({
  CommentSection: () =>
    React.createElement('div', { 'data-testid': 'comment-section' }, 'Comments mock'),
}));
vi.mock('@/components/AttachmentSection', () => ({
  AttachmentSection: () =>
    React.createElement('div', { 'data-testid': 'attachment-section' }, 'Attachments mock'),
}));
vi.mock('@/components/WorkLogSection', () => ({ WorkLogSection: () => null }));
vi.mock('@/components/TaskEstimateBar', () => ({ TaskEstimateBar: () => null }));
vi.mock('@/components/PullRequestsSection', () => ({ PullRequestsSection: () => null }));
vi.mock('@/components/TaskTypeSelector', () => ({ TaskTypeSelector: () => null }));
vi.mock('@/components/TagPicker', () => ({ TagPicker: () => null }));
vi.mock('@/components/WatcherControl', () => ({ WatcherControl: () => null }));
vi.mock('@/components/tasks/dependencies-section', () => ({
  DependenciesSection: () => null,
}));
vi.mock('@/components/tasks/recurrence-editor', () => ({
  RecurrenceEditor: ({ onActiveChange }: { onActiveChange: (v: boolean) => void }) => {
    // Settle the active-change hook synchronously on mount
    React.useEffect(() => { onActiveChange(false); }, [onActiveChange]);
    return null;
  },
}));
vi.mock('@/components/templates/SaveAsTemplateModal', () => ({
  SaveAsTemplateModal: () => null,
}));
vi.mock('@/components/sharing/ShareModal', () => ({ ShareModal: () => null }));
vi.mock('@/components/custom-fields/CustomFieldCell', () => ({
  CustomFieldCell: () => null,
}));
vi.mock('@/components/custom-fields/RelationshipField', () => ({
  RelationshipField: () => null,
}));
vi.mock('@/components/task-drawer/ActivityTab', () => ({
  ActivityTab: () =>
    React.createElement('div', { 'data-testid': 'activity-tab' }, 'Activity mock'),
}));

// ─── Component under test (imported after all mocks) ─────────────────────────
import { TaskDrawer } from '../../TaskDrawer';

// ─── Minimal task fixture ─────────────────────────────────────────────────────
const TASK = {
  Id:       'task-abc',
  IssueKey: 'PROJ-1',
  Title:    'Test Task',
  Status:   'To Do',
  Priority: 'MEDIUM',
};

function renderDrawer(onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TaskDrawer task={TASK} workspaceId="ws-1" onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('TaskDrawer tabs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a tablist with four tabs', () => {
    renderDrawer();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('Details tab is selected by default', () => {
    renderDrawer();
    const details = screen.getByRole('tab', { name: /details/i });
    expect(details).toHaveAttribute('aria-selected', 'true');
    expect(details).toHaveAttribute('tabindex', '0');

    const comments = screen.getByRole('tab', { name: /comments/i });
    expect(comments).toHaveAttribute('aria-selected', 'false');
    expect(comments).toHaveAttribute('tabindex', '-1');
  });

  it('clicking Comments tab sets aria-selected=true and shows Comments panel', () => {
    renderDrawer();
    const commentsTab = screen.getByRole('tab', { name: /comments/i });

    act(() => { fireEvent.click(commentsTab); });

    expect(commentsTab).toHaveAttribute('aria-selected', 'true');
    expect(commentsTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-tab-comments');
    expect(screen.getByTestId('comment-section')).toBeInTheDocument();
  });

  it('ArrowRight from Comments moves to Files tab', () => {
    renderDrawer();
    const commentsTab = screen.getByRole('tab', { name: /comments/i });

    act(() => { fireEvent.click(commentsTab); });
    act(() => { fireEvent.keyDown(commentsTab, { key: 'ArrowRight' }); });

    const filesTab = screen.getByRole('tab', { name: /files/i });
    expect(filesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-tab-files');
  });

  it('ArrowLeft from Details wraps to Activity (last tab)', () => {
    renderDrawer();
    const detailsTab = screen.getByRole('tab', { name: /details/i });

    act(() => { fireEvent.keyDown(detailsTab, { key: 'ArrowLeft' }); });

    const activityTab = screen.getByRole('tab', { name: /activity/i });
    expect(activityTab).toHaveAttribute('aria-selected', 'true');
  });

  it('tabpanel id matches the active tab', () => {
    renderDrawer();
    act(() => { fireEvent.click(screen.getByRole('tab', { name: /files/i })); });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'task-panel-files');
    expect(panel).toHaveAttribute('aria-labelledby', 'task-tab-files');
  });

  it('drawer dialog has aria-modal="true"', () => {
    renderDrawer();
    // The drawer renders role="dialog" aria-modal="true"; the overlay also
    // renders but has no role so getByRole finds the dialog uniquely.
    const dialogs = screen.getAllByRole('dialog');
    const drawer = dialogs.find((d) => d.getAttribute('aria-modal') === 'true');
    expect(drawer).toBeTruthy();
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDrawer(onClose);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
