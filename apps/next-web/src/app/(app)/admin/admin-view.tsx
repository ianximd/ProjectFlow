'use client';

import { useState, useCallback, useRef, useEffect, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  loadUserRoleAssignments,
  loadRoles,
  loadAllWorkspacesForRoles,
  assignUserRole,
  revokeUserRole,
} from '@/server/actions/admin-roles';
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
  const t = useTranslations('Admin');
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
    if (!window.confirm(t('deleteUserConfirm', { email: u.email }))) return;
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
    if (!window.confirm(t('resetPasswordConfirm', { email: u.email }))) return;
    setPendingId(u.id);
    startTransition(async () => {
      const res = await resetPassword(u.id);
      setPendingId(null);
      if (!res.ok) { notifyActionError(res); return; }
      setTempPassword({ email: u.email, password: res.data.tempPassword });
    });
  };

  const handleDisableMfa = (u: AdminUser) => {
    if (!window.confirm(t('disableMfaConfirm', { email: u.email }))) return;
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
        <h1 className={styles.title}>{t('panelTitle')}</h1>
        <p className={styles.subtitle}>{t('panelSubtitle')}</p>
      </div>

      {/* Tabs */}
      <div className={styles.tabs} role="tablist" aria-label={t('tabsAriaLabel')}>
        {(['stats', 'users', 'workspaces', 'audit', 'roles'] as Tab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`panel-${tab}`}
            id={`tab-${tab}`}
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => switchTab(tab)}
          >
            {{
              stats:      t('tabOverview'),
              users:      t('tabUsers'),
              workspaces: t('tabWorkspaces'),
              audit:      t('tabAuditLog'),
              roles:      t('tabRolesPermissions'),
            }[tab]}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeTab === 'stats' && statsData && (
        <div className={styles.statsGrid} id="panel-stats" role="tabpanel" aria-labelledby="tab-stats">
          {([
            [t('statTotalUsers'),        statsData.totalUsers],
            [t('statTotalWorkspaces'),   statsData.totalWorkspaces],
            [t('statTotalProjects'),     statsData.totalProjects],
            [t('statTotalTasks'),        statsData.totalTasks],
            [t('statTasksToday'),        statsData.tasksCreatedToday],
            [t('statLogins24h'),         statsData.loginsLast24h],
            [t('statAuditEventsToday'),  statsData.auditEventsToday],
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
            <label htmlFor="user-search" className="sr-only">{t('searchUsersLabel')}</label>
            <input
              id="user-search"
              className={styles.searchInput}
              placeholder={t('searchUsersPlaceholder')}
              defaultValue={currentSearch}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <div className={styles.filterBarRight}>
              <button
                className={styles.btnPrimary}
                onClick={() => setCreateOpen(true)}
                aria-label={t('createNewUserAriaLabel')}
              >
                {t('createNewUser')}
              </button>
            </div>
          </div>

          {selected.size > 0 && (
            <div className={styles.bulkBar} role="region" aria-label={t('bulkActionsAriaLabel')}>
              <strong>{selected.size}</strong> selected
              <button
                className={styles.btnSecondary}
                onClick={() => handleBulkSuspend(true)}
                disabled={isPending}
              >{t('bulkSuspend')}</button>
              <button
                className={styles.btnSecondary}
                onClick={() => handleBulkSuspend(false)}
                disabled={isPending}
              >{t('bulkRestore')}</button>
              <button
                className={styles.btnSecondary}
                onClick={() => setSelected(new Set())}
                style={{ marginLeft: 'auto' }}
              >{t('bulkClear')}</button>
            </div>
          )}

          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label={t('usersTableAriaLabel')}>
              <thead>
                <tr>
                  <th scope="col" className={styles.checkCol}>
                    <input
                      type="checkbox"
                      aria-label={t('colSelectAllThisPage')}
                      checked={
                        (usersData?.items?.length ?? 0) > 0 &&
                        (usersData?.items ?? []).every((u) => selected.has(u.id))
                      }
                      onChange={() => toggleSelectAll((usersData?.items ?? []).map((u) => u.id))}
                    />
                  </th>
                  <th scope="col">{t('colEmail')}</th>
                  <th scope="col">{t('colName')}</th>
                  <th scope="col">{t('colVerified')}</th>
                  <th scope="col">{t('colMfa')}</th>
                  <th scope="col">{t('colWorkspaces')}</th>
                  <th scope="col">{t('colCreated')}</th>
                  <th scope="col">{t('colStatus')}</th>
                  <th scope="col">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {(usersData?.items ?? []).length === 0 && (
                  <tr><td colSpan={9} className={styles.empty}>{t('noUsersFound')}</td></tr>
                )}
                {(usersData?.items ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className={styles.checkCol}>
                      <input
                        type="checkbox"
                        aria-label={t('colSelectUser', { email: u.email })}
                        checked={selected.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                      />
                    </td>
                    <td className={styles.mono}>{u.email}</td>
                    <td>{u.name}</td>
                    <td>
                      <span className={`${styles.badge} ${u.isEmailVerified ? styles.badgeGreen : styles.badgeYellow}`}>
                        {u.isEmailVerified ? t('verifiedYes') : t('verifiedNo')}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${u.mfaEnabled ? styles.badgeBlue : styles.badgeGray}`}>
                        {u.mfaEnabled ? t('mfaOn') : t('mfaOff')}
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
                              ? t('lockedUntil', { datetime: new Date(u.lockedUntil).toLocaleString() })
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
                          aria-label={t('ariaEdit', { email: u.email })}
                          disabled={pendingId === u.id}
                        >{t('btnEdit')}</button>

                        <button
                          className={`${styles.actionBtn} ${styles.btnEdit}`}
                          onClick={() => setRolesUser(u)}
                          aria-label={t('ariaManageRoles', { email: u.email })}
                        >{t('btnRoles')}</button>

                        {u.deletedAt ? (
                          <button
                            className={`${styles.actionBtn} ${styles.btnRestore}`}
                            onClick={() => handleRestoreUser(u)}
                            aria-label={t('ariaRestore', { email: u.email })}
                            disabled={pendingId === u.id}
                          >{t('btnRestore')}</button>
                        ) : (
                          <button
                            className={`${styles.actionBtn} ${styles.btnSuspend}`}
                            onClick={() => handleSuspendUser(u)}
                            aria-label={t('ariaSuspend', { email: u.email })}
                            disabled={pendingId === u.id}
                          >{t('btnSuspend')}</button>
                        )}

                        <button
                          className={`${styles.actionBtn} ${styles.btnRecover}`}
                          onClick={() => handleResetPassword(u)}
                          aria-label={t('ariaResetPw', { email: u.email })}
                          disabled={pendingId === u.id}
                        >{t('btnResetPw')}</button>

                        {u.mfaEnabled && (
                          <button
                            className={`${styles.actionBtn} ${styles.btnRecover}`}
                            onClick={() => handleDisableMfa(u)}
                            aria-label={t('ariaDisableMfa', { email: u.email })}
                            disabled={pendingId === u.id}
                          >{t('btnDisableMfa')}</button>
                        )}

                        <button
                          className={`${styles.actionBtn} ${styles.btnRecover}`}
                          onClick={() => handleUnlockUser(u)}
                          aria-label={t('ariaUnlock', { email: u.email })}
                          title={t('btnUnlockTitle')}
                          disabled={pendingId === u.id}
                        >{t('btnUnlock')}</button>

                        <button
                          className={`${styles.actionBtn} ${styles.btnDelete}`}
                          onClick={() => handleDeleteUser(u)}
                          aria-label={t('ariaDelete', { email: u.email })}
                          disabled={pendingId === u.id}
                        >{t('btnDelete')}</button>
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
            <table className={styles.table} aria-label={t('workspacesTableAriaLabel')}>
              <thead>
                <tr>
                  <th scope="col">{t('colWsName')}</th>
                  <th scope="col">{t('colWsSlug')}</th>
                  <th scope="col">{t('colWsOwner')}</th>
                  <th scope="col">{t('colWsMembers')}</th>
                  <th scope="col">{t('colWsProjects')}</th>
                  <th scope="col">{t('colWsCreated')}</th>
                  <th scope="col">{t('colWsStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {(workspacesData?.items ?? []).length === 0 && (
                  <tr><td colSpan={7} className={styles.empty}>{t('noWorkspacesFound')}</td></tr>
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
                                aria-label={t('changeWsStatusAria', { name: w.name })}
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
            <label htmlFor="audit-resource" className="sr-only">{t('auditFilterResourceLabel')}</label>
            <select
              id="audit-resource"
              className={styles.filterSelect}
              value={currentResource}
              onChange={(e) => navigate({ resource: e.target.value || undefined, page: undefined })}
              aria-label={t('auditFilterResourceAria')}
            >
              <option value="">{t('auditAllResources')}</option>
              {['Task','Project','Sprint','Workspace','Comment','AutomationRule',
                'Webhook','OutgoingWebhook','WorkLog','Version','Label','Component',
                'Epic','GitIntegration','Auth','Admin',
              ].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>

            <label htmlFor="audit-action" className="sr-only">{t('auditFilterActionLabel')}</label>
            <select
              id="audit-action"
              className={styles.filterSelect}
              value={currentAction}
              onChange={(e) => navigate({ action: e.target.value || undefined, page: undefined })}
              aria-label={t('auditFilterActionAria')}
            >
              <option value="">{t('auditAllActions')}</option>
              {['CREATE','UPDATE','DELETE','LOGIN','LOGOUT'].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <label htmlFor="audit-from" className="sr-only">{t('auditFromDateLabel')}</label>
            <input
              id="audit-from"
              className={styles.dateInput}
              type="date"
              aria-label={t('auditFromDateAria')}
              value={currentFrom}
              onChange={(e) => navigate({ from: e.target.value || undefined, page: undefined })}
            />
            <label htmlFor="audit-to" className="sr-only">{t('auditToDateLabel')}</label>
            <input
              id="audit-to"
              className={styles.dateInput}
              type="date"
              aria-label={t('auditToDateAria')}
              value={currentTo}
              onChange={(e) => navigate({ to: e.target.value || undefined, page: undefined })}
            />
            <button className={styles.pageBtn} onClick={resetAuditFilters} aria-label={t('auditClearFiltersAria')}>
              {t('auditClearFilters')}
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label={t('auditTableAriaLabel')}>
              <thead>
                <tr>
                  <th scope="col">{t('colAuditTime')}</th>
                  <th scope="col">{t('colAuditUser')}</th>
                  <th scope="col">{t('colAuditAction')}</th>
                  <th scope="col">{t('colAuditResource')}</th>
                  <th scope="col">{t('colAuditResourceId')}</th>
                  <th scope="col">{t('colAuditIp')}</th>
                  <th scope="col">{t('colAuditChanges')}</th>
                </tr>
              </thead>
              <tbody>
                {(auditData?.items ?? []).length === 0 && (
                  <tr><td colSpan={7} className={styles.empty}>{t('noAuditEventsFound')}</td></tr>
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
                            aria-label={expandedId === e.id ? t('auditHideDetails') : t('auditViewDetails')}
                            onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                          >
                            {expandedId === e.id ? t('auditHide') : t('auditView')}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === e.id && (
                      <tr key={e.id + '-detail'}>
                        <td colSpan={7} style={{ background: '#0f172a', padding: '0.75rem 1rem' }}>
                          {e.oldValues && (
                            <>
                              <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('auditBefore')}</div>
                              <pre className={styles.jsonPre}>{JSON.stringify(e.oldValues, null, 2)}</pre>
                            </>
                          )}
                          {e.newValues && (
                            <>
                              <div style={{ color: '#94a3b8', fontSize: '0.7rem', margin: '0.5rem 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('auditAfter')}</div>
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
  const t = useTranslations('Admin');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={styles.pagination}>
      <span>{t('paginationPage', { page, total: totalPages, count: total.toLocaleString() })}</span>
      <button className={styles.pageBtn} disabled={page <= 1} onClick={onPrev}>{t('paginationPrev')}</button>
      <button className={styles.pageBtn} disabled={page >= totalPages} onClick={onNext}>{t('paginationNext')}</button>
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
  const t = useTranslations('Admin');
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
    <Dialog open={open} onClose={onClose} title={t('createUserDialogTitle')}>
      <form onSubmit={submit}>
        <div className={styles.dialogBody}>
          <div className={styles.dialogField}>
            <label htmlFor="cu-email">{t('cuEmailLabel')}</label>
            <input id="cu-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className={styles.dialogField}>
            <label htmlFor="cu-name">{t('cuNameLabel')}</label>
            <input id="cu-name" required value={name}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={styles.dialogField}>
            <label htmlFor="cu-password">{t('cuPasswordLabel')}</label>
            <input id="cu-password" type="text" value={password} placeholder={t('cuPasswordPlaceholder')}
              onChange={(e) => setPassword(e.target.value)} />
            <span className={styles.dialogHint}>
              {t('cuPasswordHint')}
            </span>
          </div>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', color: '#475569' }}>
            <input type="checkbox" checked={isEmailVerified}
              onChange={(e) => setIsEmailVerified(e.target.checked)} />
            {t('cuMarkVerified')}
          </label>
          {error && <div className={styles.dialogWarn}>{error}</div>}
        </div>
        <div className={styles.dialogFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={isPending}>
            {t('cuCancel')}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={isPending || !email || !name}>
            {isPending ? t('cuCreating') : t('cuCreate')}
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
  const t = useTranslations('Admin');
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
    <Dialog open={user !== null} onClose={onClose} title={t('editUserDialogTitle', { email: user?.email ?? '' })}>
      <form onSubmit={submit}>
        <div className={styles.dialogBody}>
          <div className={styles.dialogField}>
            <label htmlFor="eu-email">{t('euEmailLabel')}</label>
            <input id="eu-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className={styles.dialogField}>
            <label htmlFor="eu-name">{t('euNameLabel')}</label>
            <input id="eu-name" required value={name}
              onChange={(e) => setName(e.target.value)} />
          </div>
          {error && <div className={styles.dialogWarn}>{error}</div>}
        </div>
        <div className={styles.dialogFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={isPending}>
            {t('euCancel')}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={isPending}>
            {isPending ? t('euSaving') : t('euSaveChanges')}
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
  const t = useTranslations('Admin');
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
    <Dialog open={data !== null} onClose={onClose} title={t('tempPasswordDialogTitle')}>
      <div className={styles.dialogBody}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569' }}>
          {t('tempPasswordFor')} <strong>{data?.email}</strong>:
        </p>
        <div className={styles.tempPasswordBox}>{data?.password}</div>
        <div className={styles.dialogWarn}>
          {t('tempPasswordWarning')}
        </div>
      </div>
      <div className={styles.dialogFooter}>
        <button type="button" className={styles.btnSecondary} onClick={copy}>
          {copied ? t('tempPasswordCopied') : t('tempPasswordCopy')}
        </button>
        <button type="button" className={styles.btnPrimary} onClick={onClose}>
          {t('tempPasswordSaved')}
        </button>
      </div>
    </Dialog>
  );
}

// ─── Manage user's roles ──────────────────────────────────────────────────────
// Converted to Server Actions in Phase 3 (Batch I): assignments / roles /
// workspaces load via admin-roles loaders; assign + revoke go through Server
// Actions that revalidate /admin. No in-memory token.

function UserRolesDialog({
  user, onClose,
}: {
  user:    AdminUser | null;
  onClose: () => void;
}) {
  const t = useTranslations('Admin');
  const userId = user?.id ?? null;

  const [assignments, setAssignments] = useState<UserRoleAssignment[]>([]);
  const [roles,       setRoles]       = useState<RoleWithCounts[]>([]);
  const [workspaces,  setWorkspaces]  = useState<AdminWorkspace[]>([]);
  const [pickRoleId,  setPickRoleId]  = useState('');
  const [pickWsId,    setPickWsId]    = useState('');
  const [pending, start]              = useTransition();
  const [assignError, setAssignError] = useState<string | null>(null);

  const refetchAssignments = () => {
    if (userId) {
      loadUserRoleAssignments(userId)
        .then(setAssignments)
        .catch(() => notifyActionError({ error: 'Failed to reload role assignments' }));
    }
  };

  useEffect(() => {
    if (!userId) return;
    setPickRoleId(''); setPickWsId(''); setAssignError(null);
    loadUserRoleAssignments(userId).then(setAssignments).catch(() => setAssignments([]));
    loadRoles().then(setRoles).catch(() => setRoles([]));
    loadAllWorkspacesForRoles().then(setWorkspaces).catch(() => setWorkspaces([]));
  }, [userId]);

  const pickRole = roles.find((r) => r.id === pickRoleId);
  const needsWs  = pickRole?.scope === 'WORKSPACE';

  const onAssign = () => start(async () => {
    if (!userId) return;
    setAssignError(null);
    const r = await assignUserRole(userId, { roleId: pickRoleId, workspaceId: needsWs ? pickWsId : null });
    if (!r.ok) { setAssignError(r.error); notifyActionError(r); return; }
    setPickRoleId(''); setPickWsId('');
    refetchAssignments();
  });

  const onRevoke = (roleId: string, workspaceId: string | null) => start(async () => {
    if (!userId) return;
    const r = await revokeUserRole(userId, roleId, workspaceId);
    if (!r.ok) return notifyActionError(r);
    refetchAssignments();
  });

  const heldKeys = new Set(assignments.map((a) => `${a.roleId}:${a.workspaceId ?? ''}`));
  const candidateRoles = roles.filter((r) => {
    const key = `${r.id}:${r.scope === 'WORKSPACE' ? (pickWsId || '') : ''}`;
    if (r.scope === 'WORKSPACE' && !pickWsId) return true;
    return !heldKeys.has(key);
  });

  const canAssign = !!pickRoleId && (!needsWs || !!pickWsId) && !pending;

  return (
    <Dialog open={user !== null} onClose={onClose} title={t('userRolesDialogTitle', { email: user?.email ?? '' })}>
      <div className={styles.dialogBody}>
        {assignments.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
            {t('userRolesNoRoles')}
          </p>
        ) : (
          <table className={styles.table} style={{ marginTop: 0 }}>
            <thead>
              <tr>
                <th scope="col">{t('colRoleName')}</th>
                <th scope="col">{t('colRoleScope')}</th>
                <th scope="col">{t('colRoleWorkspace')}</th>
                <th scope="col">{t('colRoleAssigned')}</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={`${a.roleId}:${a.workspaceId ?? 'sys'}`}>
                  <td>{a.roleName}</td>
                  <td>
                    <span className={`${styles.badge} ${a.roleScope === 'SYSTEM' ? styles.badgeRed : styles.badgeBlue}`}>
                      {a.roleScope === 'SYSTEM' ? t('roleScopeSystem') : t('roleScopeWorkspace')}
                    </span>
                  </td>
                  <td className={styles.mono}>{a.workspaceName ?? '—'}</td>
                  <td className={styles.mono}>{a.assignedAt.slice(0, 10)}</td>
                  <td>
                    <button
                      className={`${styles.actionBtn} ${styles.btnDelete}`}
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(t('revokeConfirm', { role: a.roleName, email: user?.email ?? '' }))) {
                          onRevoke(a.roleId, a.workspaceId);
                        }
                      }}
                      aria-label={t('ariaRevoke', { role: a.roleName })}
                    >{t('btnRevoke')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>
            {t('assignNewRole')}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={pickRoleId}
              onChange={(e) => { setPickRoleId(e.target.value); setPickWsId(''); }}
              className={styles.filterSelect}
              aria-label={t('roleToAssignAria')}
            >
              <option value="">{t('selectRolePlaceholder')}</option>
              {candidateRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.scope === 'SYSTEM' ? t('roleScopeSystem') : t('roleScopeWorkspace')})
                </option>
              ))}
            </select>

            {needsWs && (
              <select
                value={pickWsId}
                onChange={(e) => setPickWsId(e.target.value)}
                className={styles.filterSelect}
                aria-label={t('workspaceAria')}
              >
                <option value="">{t('workspacePlaceholder')}</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            )}

            <button
              type="button"
              className={styles.btnPrimary}
              disabled={!canAssign}
              onClick={onAssign}
            >
              {pending ? t('assigning') : t('assign')}
            </button>
          </div>
          {assignError && (
            <div className={styles.dialogWarn} style={{ marginTop: '0.5rem' }}>
              {assignError}
            </div>
          )}
        </div>
      </div>
      <div className={styles.dialogFooter}>
        <button type="button" className={styles.btnSecondary} onClick={onClose}>
          {t('rolesDialogClose')}
        </button>
      </div>
    </Dialog>
  );
}
