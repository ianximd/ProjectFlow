'use client';

import { useState, useCallback, useRef, useEffect, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styles from './page.module.css';
import type {
  AdminStats,
  AdminUser,
  AdminWorkspace,
  AuditLogEntry,
  RoleWithCounts,
  UserRoleAssignment,
  WorkspaceStatus,
} from '@projectflow/types';
import { RolesTab } from '@/components/admin/RolesTab';
import { getUserStatus } from '@/lib/userStatus';
import { getWorkspaceStatus, SETTABLE_STATUSES } from '@/lib/workspaceStatus';
import { notifyActionError } from '@/lib/apiErrorToast';
import {
  createUser,
  updateUser,
  deleteUser,
  suspendUser,
  restoreUser,
  resetPassword,
  disableMfa,
  unlockUser,
  bulkSuspend,
  setWorkspaceStatus,
} from '@/server/actions/admin';
import type { AdminUsersResult, AdminWorkspacesResult, AuditLogResult } from '@/server/queries/admin';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'stats' | 'users' | 'workspaces' | 'audit' | 'roles';

// ─── Action colours ───────────────────────────────────────────────────────────

const ACTION_BADGE: Record<string, string> = {
  CREATE: styles.badgeGreen,
  UPDATE: styles.badgeBlue,
  DELETE: styles.badgeRed,
  LOGIN:  styles.badgeYellow,
  LOGOUT: styles.badgeGray,
};

function actionBadge(action: string) {
  return ACTION_BADGE[action] ?? styles.badgeGray;
}

const PAGE_SIZE = 50;

// ─── Props ────────────────────────────────────────────────────────────────────

interface AdminViewProps {
  activeTab:        Tab;
  statsData:        AdminStats | null;
  usersData:        AdminUsersResult | null;
  workspacesData:   AdminWorkspacesResult | null;
  auditData:        AuditLogResult | null;
  currentPage:      number;
  currentSearch:    string;
  currentResource:  string;
  currentAction:    string;
  currentFrom:      string;
  currentTo:        string;
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

function useAdminNav() {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();

  const navigate = useCallback((patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') params.delete(k);
      else params.set(k, v);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, sp]);

  return navigate;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminView({
  activeTab,
  statsData,
  usersData,
  workspacesData,
  auditData,
  currentPage,
  currentSearch,
  currentResource,
  currentAction,
  currentFrom,
  currentTo,
}: AdminViewProps) {
  const navigate = useAdminNav();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // ── Tab switching ──────────────────────────────────────────────────────────

  const switchTab = (t: Tab) => {
    navigate({ tab: t === 'stats' ? undefined : t, page: undefined, q: undefined,
               resource: undefined, action: undefined, from: undefined, to: undefined });
  };

  // ── Users local state ──────────────────────────────────────────────────────

  const [createOpen,   setCreateOpen]   = useState(false);
  const [editingUser,  setEditingUser]  = useState<AdminUser | null>(null);
  const [rolesUser,    setRolesUser]    = useState<AdminUser | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());

  // search debounce
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = (val: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      navigate({ q: val || undefined, page: undefined });
    }, 300);
  };
  useEffect(() => () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = (ids: string[]) => {
    setSelected((prev) =>
      ids.every((i) => prev.has(i)) ? new Set() : new Set(ids),
    );
  };

  // ── Audit local state ──────────────────────────────────────────────────────

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const resetAuditFilters = useCallback(() => {
    navigate({ resource: undefined, action: undefined, from: undefined, to: undefined, page: undefined });
  }, [navigate]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const handleCreateUser = (input: { email: string; name: string; password?: string; isEmailVerified: boolean }) => {
    startTransition(async () => {
      const res = await createUser(input);
      if (!res.ok) { notifyActionError(res); return; }
      if (res.data?.tempPassword) {
        setTempPassword({ email: input.email, password: res.data.tempPassword });
      }
      setCreateOpen(false);
    });
  };

  const handleUpdateUser = (id: string, fields: { email?: string; name?: string }) => {
    startTransition(async () => {
      const res = await updateUser(id, fields);
      if (!res.ok) { notifyActionError(res); return; }
      setEditingUser(null);
    });
  };

  const handleDeleteUser = (u: AdminUser) => {
    if (!window.confirm(
      `Permanently delete ${u.email}?\n\nThis cannot be undone. The action will be refused if the user owns workspaces, has reported tasks, comments, attachments, or work logs — suspend them and reassign their work first.`,
    )) return;
    setPendingId(u.id);
    startTransition(async () => {
      const res = await deleteUser(u.id);
      setPendingId(null);
      if (!res.ok) { notifyActionError(res); return; }
      setSelected(new Set());
    });
  };

  const handleSuspendUser = (u: AdminUser) => {
    setPendingId(u.id);
    startTransition(async () => {
      const res = await suspendUser(u.id);
      setPendingId(null);
      if (!res.ok) notifyActionError(res);
    });
  };

  const handleRestoreUser = (u: AdminUser) => {
    setPendingId(u.id);
    startTransition(async () => {
      const res = await restoreUser(u.id);
      setPendingId(null);
      if (!res.ok) notifyActionError(res);
    });
  };

  const handleResetPassword = (u: AdminUser) => {
    if (!window.confirm(
      `Generate a new temporary password for ${u.email}?\n\nThe current password will stop working immediately.`,
    )) return;
    setPendingId(u.id);
    startTransition(async () => {
      const res = await resetPassword(u.id);
      setPendingId(null);
      if (!res.ok) { notifyActionError(res); return; }
      setTempPassword({ email: u.email, password: res.data.tempPassword });
    });
  };

  const handleDisableMfa = (u: AdminUser) => {
    if (!window.confirm(
      `Disable MFA for ${u.email}?\n\nThe user will be able to sign in with just their password.`,
    )) return;
    setPendingId(u.id);
    startTransition(async () => {
      const res = await disableMfa(u.id);
      setPendingId(null);
      if (!res.ok) notifyActionError(res);
    });
  };

  const handleUnlockUser = (u: AdminUser) => {
    setPendingId(u.id);
    startTransition(async () => {
      const res = await unlockUser(u.id);
      setPendingId(null);
      if (!res.ok) notifyActionError(res);
    });
  };

  const handleBulkSuspend = (suspend: boolean) => {
    startTransition(async () => {
      const res = await bulkSuspend([...selected], suspend);
      if (!res.ok) { notifyActionError(res); return; }
      setSelected(new Set());
    });
  };

  const handleWsStatusChange = (workspaceId: string, status: WorkspaceStatus) => {
    setPendingId(workspaceId);
    startTransition(async () => {
      const res = await setWorkspaceStatus(workspaceId, status);
      setPendingId(null);
      if (!res.ok) notifyActionError(res);
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin Panel</h1>
        <p className={styles.subtitle}>System management &amp; audit log viewer</p>
      </div>

      {/* Tabs */}
      <div className={styles.tabs} role="tablist" aria-label="Admin sections">
        {(['stats', 'users', 'workspaces', 'audit', 'roles'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            aria-controls={`panel-${t}`}
            id={`tab-${t}`}
            className={`${styles.tab} ${activeTab === t ? styles.tabActive : ''}`}
            onClick={() => switchTab(t)}
          >
            {{ stats: 'Overview', users: 'Users', workspaces: 'Workspaces', audit: 'Audit Log', roles: 'Roles & Permissions' }[t]}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeTab === 'stats' && statsData && (
        <div className={styles.statsGrid} id="panel-stats" role="tabpanel" aria-labelledby="tab-stats">
          {([
            ['Total Users',         statsData.totalUsers],
            ['Total Workspaces',    statsData.totalWorkspaces],
            ['Total Projects',      statsData.totalProjects],
            ['Total Tasks',         statsData.totalTasks],
            ['Tasks Today',         statsData.tasksCreatedToday],
            ['Logins (24h)',        statsData.loginsLast24h],
            ['Audit Events Today',  statsData.auditEventsToday],
          ] as [string, number][]).map(([label, value]) => (
            <div key={label} className={styles.statCard}>
              <div className={styles.statValue}>{value.toLocaleString()}</div>
              <div className={styles.statLabel}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Users ── */}
      {activeTab === 'users' && (
        <div id="panel-users" role="tabpanel" aria-labelledby="tab-users">
          <div className={styles.filterBar}>
            <label htmlFor="user-search" className="sr-only">Search users</label>
            <input
              id="user-search"
              className={styles.searchInput}
              placeholder="Search by name or email…"
              defaultValue={currentSearch}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <div className={styles.filterBarRight}>
              <button
                className={styles.btnPrimary}
                onClick={() => setCreateOpen(true)}
                aria-label="Create new user"
              >
                + New user
              </button>
            </div>
          </div>

          {selected.size > 0 && (
            <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
              <strong>{selected.size}</strong> selected
              <button
                className={styles.btnSecondary}
                onClick={() => handleBulkSuspend(true)}
                disabled={isPending}
              >Suspend</button>
              <button
                className={styles.btnSecondary}
                onClick={() => handleBulkSuspend(false)}
                disabled={isPending}
              >Restore</button>
              <button
                className={styles.btnSecondary}
                onClick={() => setSelected(new Set())}
                style={{ marginLeft: 'auto' }}
              >Clear</button>
            </div>
          )}

          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Users">
              <thead>
                <tr>
                  <th scope="col" className={styles.checkCol}>
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={
                        (usersData?.items?.length ?? 0) > 0 &&
                        (usersData?.items ?? []).every((u) => selected.has(u.id))
                      }
                      onChange={() => toggleSelectAll((usersData?.items ?? []).map((u) => u.id))}
                    />
                  </th>
                  <th scope="col">Email</th>
                  <th scope="col">Name</th>
                  <th scope="col">Verified</th>
                  <th scope="col">MFA</th>
                  <th scope="col">Workspaces</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(usersData?.items ?? []).length === 0 && (
                  <tr><td colSpan={9} className={styles.empty}>No users found</td></tr>
                )}
                {(usersData?.items ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className={styles.checkCol}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${u.email}`}
                        checked={selected.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                      />
                    </td>
                    <td className={styles.mono}>{u.email}</td>
                    <td>{u.name}</td>
                    <td>
                      <span className={`${styles.badge} ${u.isEmailVerified ? styles.badgeGreen : styles.badgeYellow}`}>
                        {u.isEmailVerified ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${u.mfaEnabled ? styles.badgeBlue : styles.badgeGray}`}>
                        {u.mfaEnabled ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td>{u.workspaceCount}</td>
                    <td className={styles.mono}>{u.createdAt.slice(0, 10)}</td>
                    <td>
                      {(() => {
                        const { label, tone } = getUserStatus(u);
                        const toneClass = tone === 'red'    ? styles.badgeRed
                                       : tone === 'orange' ? styles.badgeOrange
                                       : tone === 'yellow' ? styles.badgeYellow
                                       :                     styles.badgeGreen;
                        return (
                          <span
                            className={`${styles.badge} ${toneClass}`}
                            title={u.lockedUntil && tone === 'orange'
                              ? `Locked until ${new Date(u.lockedUntil).toLocaleString()}`
                              : undefined}
                          >
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      <div className={styles.actionRow}>
                        <button
                          className={`${styles.actionBtn} ${styles.btnEdit}`}
                          onClick={() => setEditingUser(u)}
                          aria-label={`Edit ${u.email}`}
                          disabled={pendingId === u.id}
                        >Edit</button>

                        <button
                          className={`${styles.actionBtn} ${styles.btnEdit}`}
                          onClick={() => setRolesUser(u)}
                          aria-label={`Manage roles for ${u.email}`}
                        >Roles</button>

                        {u.deletedAt ? (
                          <button
                            className={`${styles.actionBtn} ${styles.btnRestore}`}
                            onClick={() => handleRestoreUser(u)}
                            aria-label={`Restore ${u.email}`}
                            disabled={pendingId === u.id}
                          >Restore</button>
                        ) : (
                          <button
                            className={`${styles.actionBtn} ${styles.btnSuspend}`}
                            onClick={() => handleSuspendUser(u)}
                            aria-label={`Suspend ${u.email}`}
                            disabled={pendingId === u.id}
                          >Suspend</button>
                        )}

                        <button
                          className={`${styles.actionBtn} ${styles.btnRecover}`}
                          onClick={() => handleResetPassword(u)}
                          aria-label={`Reset password for ${u.email}`}
                          disabled={pendingId === u.id}
                        >Reset PW</button>

                        {u.mfaEnabled && (
                          <button
                            className={`${styles.actionBtn} ${styles.btnRecover}`}
                            onClick={() => handleDisableMfa(u)}
                            aria-label={`Disable MFA for ${u.email}`}
                            disabled={pendingId === u.id}
                          >Disable MFA</button>
                        )}

                        <button
                          className={`${styles.actionBtn} ${styles.btnRecover}`}
                          onClick={() => handleUnlockUser(u)}
                          aria-label={`Unlock ${u.email}`}
                          title="Clear failed-login lockout"
                          disabled={pendingId === u.id}
                        >Unlock</button>

                        <button
                          className={`${styles.actionBtn} ${styles.btnDelete}`}
                          onClick={() => handleDeleteUser(u)}
                          aria-label={`Delete ${u.email}`}
                          disabled={pendingId === u.id}
                        >Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={currentPage}
            total={usersData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => navigate({ page: String(currentPage - 1) })}
            onNext={() => navigate({ page: String(currentPage + 1) })}
          />

          {/* ── Dialogs ── */}
          <CreateUserDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onSubmit={handleCreateUser}
            isPending={isPending}
            error={null}
          />

          <EditUserDialog
            user={editingUser}
            onClose={() => setEditingUser(null)}
            onSubmit={(fields) => editingUser && handleUpdateUser(editingUser.id, fields)}
            isPending={isPending}
            error={null}
          />

          <TempPasswordDialog
            data={tempPassword}
            onClose={() => setTempPassword(null)}
          />

          <UserRolesDialog
            user={rolesUser}
            onClose={() => setRolesUser(null)}
          />
        </div>
      )}

      {/* ── Workspaces ── */}
      {activeTab === 'workspaces' && (
        <div id="panel-workspaces" role="tabpanel" aria-labelledby="tab-workspaces">
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Workspaces">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Members</th>
                  <th scope="col">Projects</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {(workspacesData?.items ?? []).length === 0 && (
                  <tr><td colSpan={7} className={styles.empty}>No workspaces found</td></tr>
                )}
                {(workspacesData?.items ?? []).map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td className={styles.mono}>{w.slug}</td>
                    <td className={styles.mono}>{w.ownerEmail ?? '—'}</td>
                    <td>{w.memberCount}</td>
                    <td>{w.projectCount}</td>
                    <td className={styles.mono}>{w.createdAt.slice(0, 10)}</td>
                    <td>
                      {(() => {
                        const { label, tone } = getWorkspaceStatus(w);
                        const toneClass = tone === 'red'    ? styles.badgeRed
                                       : tone === 'orange' ? styles.badgeOrange
                                       : tone === 'yellow' ? styles.badgeYellow
                                       : tone === 'blue'   ? styles.badgeBlue
                                       :                     styles.badgeGreen;
                        return (
                          <div className={styles.statusCell}>
                            <span className={`${styles.badge} ${toneClass}`}>{label}</span>
                            {!w.deletedAt && (
                              <select
                                aria-label={`Change status of ${w.name}`}
                                className={styles.statusSelect}
                                value={w.status}
                                onChange={(e) => handleWsStatusChange(w.id, e.target.value as WorkspaceStatus)}
                                disabled={pendingId === w.id}
                              >
                                {SETTABLE_STATUSES.map((s) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={currentPage}
            total={workspacesData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => navigate({ page: String(currentPage - 1) })}
            onNext={() => navigate({ page: String(currentPage + 1) })}
          />
        </div>
      )}

      {/* ── Audit Log ── */}
      {activeTab === 'audit' && (
        <div id="panel-audit" role="tabpanel" aria-labelledby="tab-audit">
          <div className={styles.filterBar}>
            <label htmlFor="audit-resource" className="sr-only">Filter by resource</label>
            <select
              id="audit-resource"
              className={styles.filterSelect}
              value={currentResource}
              onChange={(e) => navigate({ resource: e.target.value || undefined, page: undefined })}
              aria-label="Filter by resource"
            >
              <option value="">All resources</option>
              {['Task','Project','Sprint','Workspace','Comment','AutomationRule',
                'Webhook','OutgoingWebhook','WorkLog','Version','Label','Component',
                'Epic','GitIntegration','Auth','Admin',
              ].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>

            <label htmlFor="audit-action" className="sr-only">Filter by action</label>
            <select
              id="audit-action"
              className={styles.filterSelect}
              value={currentAction}
              onChange={(e) => navigate({ action: e.target.value || undefined, page: undefined })}
              aria-label="Filter by action"
            >
              <option value="">All actions</option>
              {['CREATE','UPDATE','DELETE','LOGIN','LOGOUT'].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <label htmlFor="audit-from" className="sr-only">From date</label>
            <input
              id="audit-from"
              className={styles.dateInput}
              type="date"
              aria-label="From date"
              value={currentFrom}
              onChange={(e) => navigate({ from: e.target.value || undefined, page: undefined })}
            />
            <label htmlFor="audit-to" className="sr-only">To date</label>
            <input
              id="audit-to"
              className={styles.dateInput}
              type="date"
              aria-label="To date"
              value={currentTo}
              onChange={(e) => navigate({ to: e.target.value || undefined, page: undefined })}
            />
            <button className={styles.pageBtn} onClick={resetAuditFilters} aria-label="Clear all filters">
              Clear
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Audit log">
              <thead>
                <tr>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">User</th>
                  <th scope="col">Action</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Resource ID</th>
                  <th scope="col">IP</th>
                  <th scope="col">Changes</th>
                </tr>
              </thead>
              <tbody>
                {(auditData?.items ?? []).length === 0 && (
                  <tr><td colSpan={7} className={styles.empty}>No audit events found</td></tr>
                )}
                {(auditData?.items ?? []).map((e) => (
                  <>
                    <tr key={e.id}>
                      <td className={styles.mono}>{e.createdAt.replace('T', ' ').slice(0, 19)}</td>
                      <td className={styles.mono}>{e.userEmail ?? e.userId.slice(0, 8) + '…'}</td>
                      <td>
                        <span className={`${styles.badge} ${actionBadge(e.action)}`}>{e.action}</span>
                      </td>
                      <td>{e.resource}</td>
                      <td className={styles.mono}>{e.resourceId ? e.resourceId.slice(0, 12) + '…' : '—'}</td>
                      <td className={styles.mono}>{e.ipAddress ?? '—'}</td>
                      <td>
                        {(e.oldValues || e.newValues) && (
                          <button
                            className={styles.pageBtn}
                            aria-expanded={expandedId === e.id}
                            aria-label={expandedId === e.id ? 'Hide change details' : 'View change details'}
                            onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                          >
                            {expandedId === e.id ? 'Hide' : 'View'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === e.id && (
                      <tr key={e.id + '-detail'}>
                        <td colSpan={7} style={{ background: '#0f172a', padding: '0.75rem 1rem' }}>
                          {e.oldValues && (
                            <>
                              <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Before</div>
                              <pre className={styles.jsonPre}>{JSON.stringify(e.oldValues, null, 2)}</pre>
                            </>
                          )}
                          {e.newValues && (
                            <>
                              <div style={{ color: '#94a3b8', fontSize: '0.7rem', margin: '0.5rem 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>After</div>
                              <pre className={styles.jsonPre}>{JSON.stringify(e.newValues, null, 2)}</pre>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={currentPage}
            total={auditData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => navigate({ page: String(currentPage - 1) })}
            onNext={() => navigate({ page: String(currentPage + 1) })}
          />
        </div>
      )}

      {/* ── Roles & Permissions ── */}
      {activeTab === 'roles' && (
        <div id="panel-roles" role="tabpanel" aria-labelledby="tab-roles">
          <RolesTab />
        </div>
      )}
    </div>
  );
}

// ─── Pagination helper ────────────────────────────────────────────────────────

function Pagination({
  page, total, pageSize, onPrev, onNext,
}: {
  page: number; total: number; pageSize: number;
  onPrev: () => void; onNext: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={styles.pagination}>
      <span>Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
      <button className={styles.pageBtn} disabled={page <= 1} onClick={onPrev}>← Prev</button>
      <button className={styles.pageBtn} disabled={page >= totalPages} onClick={onNext}>Next →</button>
    </div>
  );
}

// ─── Native <dialog> shell ────────────────────────────────────────────────────

function Dialog({
  open, onClose, title, children,
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="dialog-title"
    >
      <div id="dialog-title" className={styles.dialogHeader}>{title}</div>
      {children}
    </dialog>
  );
}

// ─── Create user dialog ───────────────────────────────────────────────────────

function CreateUserDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { email: string; name: string; password?: string; isEmailVerified: boolean }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [email,           setEmail]           = useState('');
  const [name,            setName]            = useState('');
  const [password,        setPassword]        = useState('');
  const [isEmailVerified, setIsEmailVerified] = useState(true);

  useEffect(() => {
    if (!open) { setEmail(''); setName(''); setPassword(''); setIsEmailVerified(true); }
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      email: email.trim(),
      name:  name.trim(),
      password: password.trim() ? password : undefined,
      isEmailVerified,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title="Create new user">
      <form onSubmit={submit}>
        <div className={styles.dialogBody}>
          <div className={styles.dialogField}>
            <label htmlFor="cu-email">Email</label>
            <input id="cu-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className={styles.dialogField}>
            <label htmlFor="cu-name">Name</label>
            <input id="cu-name" required value={name}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={styles.dialogField}>
            <label htmlFor="cu-password">Password (optional)</label>
            <input id="cu-password" type="text" value={password} placeholder="Leave blank to auto-generate"
              onChange={(e) => setPassword(e.target.value)} />
            <span className={styles.dialogHint}>
              If blank, a temporary password is generated and shown once after submit.
            </span>
          </div>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', color: '#475569' }}>
            <input type="checkbox" checked={isEmailVerified}
              onChange={(e) => setIsEmailVerified(e.target.checked)} />
            Mark email as verified (skip verification flow)
          </label>
          {error && <div className={styles.dialogWarn}>{error}</div>}
        </div>
        <div className={styles.dialogFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={isPending || !email || !name}>
            {isPending ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Edit user dialog ─────────────────────────────────────────────────────────

function EditUserDialog({
  user, onClose, onSubmit, isPending, error,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onSubmit: (fields: { email?: string; name?: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState('');
  const [name,  setName]  = useState('');

  useEffect(() => {
    if (user) { setEmail(user.email); setName(user.name); }
  }, [user]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const patch: { email?: string; name?: string } = {};
    if (email.trim() !== user.email) patch.email = email.trim();
    if (name.trim()  !== user.name)  patch.name  = name.trim();
    if (Object.keys(patch).length === 0) { onClose(); return; }
    onSubmit(patch);
  };

  return (
    <Dialog open={user !== null} onClose={onClose} title={`Edit ${user?.email ?? ''}`}>
      <form onSubmit={submit}>
        <div className={styles.dialogBody}>
          <div className={styles.dialogField}>
            <label htmlFor="eu-email">Email</label>
            <input id="eu-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className={styles.dialogField}>
            <label htmlFor="eu-name">Name</label>
            <input id="eu-name" required value={name}
              onChange={(e) => setName(e.target.value)} />
          </div>
          {error && <div className={styles.dialogWarn}>{error}</div>}
        </div>
        <div className={styles.dialogFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── One-shot temporary-password reveal ───────────────────────────────────────

function TempPasswordDialog({
  data, onClose,
}: {
  data: { email: string; password: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!data) setCopied(false);
  }, [data]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.password);
      setCopied(true);
    } catch {
      // Clipboard can be denied (e.g. insecure context). User can still
      // select-all and copy manually — the box has user-select: all.
    }
  };

  return (
    <Dialog open={data !== null} onClose={onClose} title="Temporary password">
      <div className={styles.dialogBody}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569' }}>
          For <strong>{data?.email}</strong>:
        </p>
        <div className={styles.tempPasswordBox}>{data?.password}</div>
        <div className={styles.dialogWarn}>
          This password is shown only once. Send it to the user through a secure channel and ask them to change it on first login.
        </div>
      </div>
      <div className={styles.dialogFooter}>
        <button type="button" className={styles.btnSecondary} onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className={styles.btnPrimary} onClick={onClose}>
          I&apos;ve saved it
        </button>
      </div>
    </Dialog>
  );
}

// ─── Manage user's roles ──────────────────────────────────────────────────────
// This dialog is self-fetching (uses the in-memory token via RolesTab patterns).
// It is deferred: token-dependent role management is left as-is from the
// original page — we preserve it verbatim so RolesTab child components remain
// unchanged.
//
// NOTE: The original UserRolesDialog used `token` from useStore. Since we are
// in a 'use client' component we can still read it. However, to DEFER this
// self-fetching dialog (per plan), we keep it using the store token directly.
// The rest of the page (stats/users/workspaces/audit) is RSC-driven.

async function apiFetch(path: string, token: string | null, opts?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? 'Request failed');
  return json;
}

function UserRolesDialog({
  user, onClose,
}: {
  user:    AdminUser | null;
  onClose: () => void;
}) {
  const token  = useStore((s) => s.accessToken);
  const qc     = useQueryClient();
  const userId = user?.id ?? null;

  const { data: assignments = [] } = useQuery<UserRoleAssignment[]>({
    queryKey: ['admin', 'user-roles', userId],
    queryFn:  () => apiFetch(`/admin/user-roles/${userId}`, token).then((j) => j.data),
    enabled:  !!userId,
  });

  const { data: roles = [] } = useQuery<RoleWithCounts[]>({
    queryKey: ['admin', 'roles'],
    queryFn:  () => apiFetch('/admin/roles', token).then((j) => j.data),
    enabled:  !!userId,
  });

  const { data: workspaces = [] } = useQuery<AdminWorkspace[]>({
    queryKey: ['admin', 'workspaces-all'],
    queryFn:  () => apiFetch('/admin/workspaces?page=1&pageSize=200', token).then((j) => j.data),
    enabled:  !!userId,
  });

  const [pickRoleId, setPickRoleId] = useState('');
  const [pickWsId,   setPickWsId]   = useState('');

  useEffect(() => { setPickRoleId(''); setPickWsId(''); }, [userId]);

  const pickRole = roles.find((r) => r.id === pickRoleId);
  const needsWs  = pickRole?.scope === 'WORKSPACE';

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'user-roles', userId] });
    qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    if (pickRoleId) qc.invalidateQueries({ queryKey: ['admin', 'role-members', pickRoleId] });
  };

  const assignMut = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/user-roles/${userId}`, token, {
        method: 'POST',
        body:   JSON.stringify({ roleId: pickRoleId, workspaceId: needsWs ? pickWsId : null }),
      }),
    onSuccess: () => { invalidateAll(); setPickRoleId(''); setPickWsId(''); },
  });

  const revokeMut = useMutation({
    mutationFn: ({ roleId, workspaceId }: { roleId: string; workspaceId: string | null }) => {
      const q = workspaceId ? `?workspaceId=${workspaceId}` : '';
      return apiFetch(`/admin/user-roles/${userId}/${roleId}${q}`, token, { method: 'DELETE' });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'user-roles', userId] });
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      qc.invalidateQueries({ queryKey: ['admin', 'role-members', vars.roleId] });
    },
  });

  const heldKeys = new Set(assignments.map((a) => `${a.roleId}:${a.workspaceId ?? ''}`));
  const candidateRoles = roles.filter((r) => {
    const key = `${r.id}:${r.scope === 'WORKSPACE' ? (pickWsId || '') : ''}`;
    if (r.scope === 'WORKSPACE' && !pickWsId) return true;
    return !heldKeys.has(key);
  });

  const canAssign = !!pickRoleId && (!needsWs || !!pickWsId) && !assignMut.isPending;

  return (
    <Dialog open={user !== null} onClose={onClose} title={`Roles for ${user?.email ?? ''}`}>
      <div className={styles.dialogBody}>
        {assignments.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
            This user has no roles assigned yet.
          </p>
        ) : (
          <table className={styles.table} style={{ marginTop: 0 }}>
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Scope</th>
                <th scope="col">Workspace</th>
                <th scope="col">Assigned</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={`${a.roleId}:${a.workspaceId ?? 'sys'}`}>
                  <td>{a.roleName}</td>
                  <td>
                    <span className={`${styles.badge} ${a.roleScope === 'SYSTEM' ? styles.badgeRed : styles.badgeBlue}`}>
                      {a.roleScope === 'SYSTEM' ? 'System' : 'Workspace'}
                    </span>
                  </td>
                  <td className={styles.mono}>{a.workspaceName ?? '—'}</td>
                  <td className={styles.mono}>{a.assignedAt.slice(0, 10)}</td>
                  <td>
                    <button
                      className={`${styles.actionBtn} ${styles.btnDelete}`}
                      disabled={revokeMut.isPending}
                      onClick={() => {
                        if (window.confirm(`Revoke "${a.roleName}" from ${user?.email}?`)) {
                          revokeMut.mutate({ roleId: a.roleId, workspaceId: a.workspaceId });
                        }
                      }}
                      aria-label={`Revoke ${a.roleName}`}
                    >Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>
            Assign new role
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={pickRoleId}
              onChange={(e) => { setPickRoleId(e.target.value); setPickWsId(''); }}
              className={styles.filterSelect}
              aria-label="Role to assign"
            >
              <option value="">Select role…</option>
              {candidateRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.scope === 'SYSTEM' ? 'System' : 'Workspace'})
                </option>
              ))}
            </select>

            {needsWs && (
              <select
                value={pickWsId}
                onChange={(e) => setPickWsId(e.target.value)}
                className={styles.filterSelect}
                aria-label="Workspace"
              >
                <option value="">Workspace…</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            )}

            <button
              type="button"
              className={styles.btnPrimary}
              disabled={!canAssign}
              onClick={() => assignMut.mutate()}
            >
              {assignMut.isPending ? 'Assigning…' : 'Assign'}
            </button>
          </div>
          {(assignMut.error as Error | null)?.message && (
            <div className={styles.dialogWarn} style={{ marginTop: '0.5rem' }}>
              {(assignMut.error as Error).message}
            </div>
          )}
        </div>
      </div>
      <div className={styles.dialogFooter}>
        <button type="button" className={styles.btnSecondary} onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
