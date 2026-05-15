'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import styles from './page.module.css';
import type {
  AdminStats,
  AdminUser,
  AdminWorkspace,
  AuditLogEntry,
  RoleWithCounts,
  UserRoleAssignment,
} from '@projectflow/types';
import { RolesTab } from '@/components/admin/RolesTab';
import { getUserStatus } from '@/lib/userStatus';
import { getWorkspaceStatus, SETTABLE_STATUSES } from '@/lib/workspaceStatus';

// ─── API helpers ──────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const token = useStore((s) => s.accessToken);
  const qc    = useQueryClient();
  const [tab, setTab] = useState<Tab>('stats');

  // ── Stats ──────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiFetch('/admin/stats', token).then((j) => j.data),
    enabled: tab === 'stats',
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  const [userSearch, setUserSearch]   = useState('');
  const [userPage,   setUserPage]     = useState(1);
  const PAGE_SIZE = 50;

  const { data: usersData } = useQuery<{ users: AdminUser[]; total: number }>({
    queryKey: ['admin', 'users', userSearch, userPage],
    queryFn:  () =>
      apiFetch(`/admin/users?search=${encodeURIComponent(userSearch)}&page=${userPage}&pageSize=${PAGE_SIZE}`, token)
        .then((j) => ({ users: j.data, total: j.meta.total })),
    enabled:  tab === 'users',
  });

  const suspendMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/admin/users/${userId}/suspend`, token, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const restoreMutation = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/admin/users/${userId}/restore`, token, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  // ── Admin user CRUD + recovery ─────────────────────────────────────────────

  const [createOpen,   setCreateOpen]   = useState(false);
  const [editingUser,  setEditingUser]  = useState<AdminUser | null>(null);
  const [rolesUser,    setRolesUser]    = useState<AdminUser | null>(null);
  // After a successful create OR reset-password, we surface the temp password
  // in a one-shot reveal dialog. The admin must capture it then; we never
  // display it again.
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  // userId-keyed selection for bulk actions.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const createMutation = useMutation({
    mutationFn: (input: { email: string; name: string; password?: string; isEmailVerified: boolean }) =>
      apiFetch('/admin/users', token, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (json, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (json.meta?.tempPassword) {
        setTempPassword({ email: vars.email, password: json.meta.tempPassword });
      }
      setCreateOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...fields }: { id: string; email?: string; name?: string }) =>
      apiFetch(`/admin/users/${id}`, token, { method: 'PATCH', body: JSON.stringify(fields) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setEditingUser(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/users/${id}`, token, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setSelected(new Set());
    },
  });

  const resetPwMutation = useMutation({
    mutationFn: ({ id }: { id: string; email: string }) =>
      apiFetch(`/admin/users/${id}/reset-password`, token, { method: 'POST' }),
    onSuccess: (json, vars) => {
      if (json.data?.tempPassword) {
        setTempPassword({ email: vars.email, password: json.data.tempPassword });
      }
    },
  });

  const disableMfaMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/users/${id}/disable-mfa`, token, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/users/${id}/unlock`, token, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const bulkSuspendMutation = useMutation({
    mutationFn: ({ userIds, suspend }: { userIds: string[]; suspend: boolean }) =>
      apiFetch('/admin/users/bulk-suspend', token, {
        method: 'POST',
        body: JSON.stringify({ userIds, suspend }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setSelected(new Set());
    },
  });

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

  // ── Workspaces ─────────────────────────────────────────────────────────────
  const [wsPage, setWsPage] = useState(1);

  const { data: wsData } = useQuery<{ workspaces: AdminWorkspace[]; total: number }>({
    queryKey: ['admin', 'workspaces', wsPage],
    queryFn:  () =>
      apiFetch(`/admin/workspaces?page=${wsPage}&pageSize=${PAGE_SIZE}`, token)
        .then((j) => ({ workspaces: j.data, total: j.meta.total })),
    enabled:  tab === 'workspaces',
  });

  // W43 — admin can flip the operational Status enum from the table row.
  // Archived (DeletedAt set) is governed by the existing delete/restore
  // flow, not by this mutation.
  const wsStatusMutation = useMutation({
    mutationFn: ({ workspaceId, status }: { workspaceId: string; status: string }) =>
      apiFetch(`/admin/workspaces/${workspaceId}/status`, token, {
        method: 'POST',
        body:   JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'workspaces'] }),
  });

  // ── Audit log ──────────────────────────────────────────────────────────────
  const [auditResource, setAuditResource] = useState('');
  const [auditAction,   setAuditAction]   = useState('');
  const [auditFrom,     setAuditFrom]     = useState('');
  const [auditTo,       setAuditTo]       = useState('');
  const [auditPage,     setAuditPage]     = useState(1);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);

  const { data: auditData } = useQuery<{ entries: AuditLogEntry[]; total: number }>({
    queryKey: ['admin', 'audit', auditResource, auditAction, auditFrom, auditTo, auditPage],
    queryFn:  () => {
      const params = new URLSearchParams({ page: String(auditPage), pageSize: String(PAGE_SIZE) });
      if (auditResource) params.set('resource', auditResource);
      if (auditAction)   params.set('action',   auditAction);
      if (auditFrom)     params.set('fromDate',  auditFrom);
      if (auditTo)       params.set('toDate',    auditTo);
      return apiFetch(`/admin/audit-log?${params}`, token)
        .then((j) => ({ entries: j.data, total: j.meta.total }));
    },
    enabled: tab === 'audit',
  });

  const resetAuditFilters = useCallback(() => {
    setAuditResource(''); setAuditAction('');
    setAuditFrom('');     setAuditTo('');
    setAuditPage(1);
  }, []);

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
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            id={`tab-${t}`}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {{ stats: 'Overview', users: 'Users', workspaces: 'Workspaces', audit: 'Audit Log', roles: 'Roles & Permissions' }[t]}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'stats' && stats && (
        <div className={styles.statsGrid} id="panel-stats" role="tabpanel" aria-labelledby="tab-stats">
          {([
            ['Total Users',         stats.totalUsers],
            ['Total Workspaces',    stats.totalWorkspaces],
            ['Total Projects',      stats.totalProjects],
            ['Total Tasks',         stats.totalTasks],
            ['Tasks Today',         stats.tasksCreatedToday],
            ['Logins (24h)',        stats.loginsLast24h],
            ['Audit Events Today',  stats.auditEventsToday],
          ] as [string, number][]).map(([label, value]) => (
            <div key={label} className={styles.statCard}>
              <div className={styles.statValue}>{value.toLocaleString()}</div>
              <div className={styles.statLabel}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Users ── */}
      {tab === 'users' && (
        <div id="panel-users" role="tabpanel" aria-labelledby="tab-users">
          <div className={styles.filterBar}>
            <label htmlFor="user-search" className="sr-only">Search users</label>
            <input
              id="user-search"
              className={styles.searchInput}
              placeholder="Search by name or email…"
              value={userSearch}
              onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }}
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
                onClick={() => bulkSuspendMutation.mutate({ userIds: [...selected], suspend: true })}
                disabled={bulkSuspendMutation.isPending}
              >Suspend</button>
              <button
                className={styles.btnSecondary}
                onClick={() => bulkSuspendMutation.mutate({ userIds: [...selected], suspend: false })}
                disabled={bulkSuspendMutation.isPending}
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
                        (usersData?.users?.length ?? 0) > 0 &&
                        (usersData?.users ?? []).every((u) => selected.has(u.id))
                      }
                      onChange={() => toggleSelectAll((usersData?.users ?? []).map((u) => u.id))}
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
                {(usersData?.users ?? []).length === 0 && (
                  <tr><td colSpan={9} className={styles.empty}>No users found</td></tr>
                )}
                {(usersData?.users ?? []).map((u) => (
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
                        >Edit</button>

                        <button
                          className={`${styles.actionBtn} ${styles.btnEdit}`}
                          onClick={() => setRolesUser(u)}
                          aria-label={`Manage roles for ${u.email}`}
                        >Roles</button>

                        {u.deletedAt ? (
                          <button
                            className={`${styles.actionBtn} ${styles.btnRestore}`}
                            onClick={() => restoreMutation.mutate(u.id)}
                            aria-label={`Restore ${u.email}`}
                          >Restore</button>
                        ) : (
                          <button
                            className={`${styles.actionBtn} ${styles.btnSuspend}`}
                            onClick={() => suspendMutation.mutate(u.id)}
                            aria-label={`Suspend ${u.email}`}
                          >Suspend</button>
                        )}

                        <button
                          className={`${styles.actionBtn} ${styles.btnRecover}`}
                          onClick={() => {
                            if (window.confirm(`Generate a new temporary password for ${u.email}?\n\nThe current password will stop working immediately.`)) {
                              resetPwMutation.mutate({ id: u.id, email: u.email });
                            }
                          }}
                          aria-label={`Reset password for ${u.email}`}
                        >Reset PW</button>

                        {u.mfaEnabled && (
                          <button
                            className={`${styles.actionBtn} ${styles.btnRecover}`}
                            onClick={() => {
                              if (window.confirm(`Disable MFA for ${u.email}?\n\nThe user will be able to sign in with just their password.`)) {
                                disableMfaMutation.mutate(u.id);
                              }
                            }}
                            aria-label={`Disable MFA for ${u.email}`}
                          >Disable MFA</button>
                        )}

                        <button
                          className={`${styles.actionBtn} ${styles.btnRecover}`}
                          onClick={() => unlockMutation.mutate(u.id)}
                          aria-label={`Unlock ${u.email}`}
                          title="Clear failed-login lockout"
                        >Unlock</button>

                        <button
                          className={`${styles.actionBtn} ${styles.btnDelete}`}
                          onClick={() => {
                            if (window.confirm(`Permanently delete ${u.email}?\n\nThis cannot be undone. The action will be refused if the user owns workspaces, has reported tasks, comments, attachments, or work logs — suspend them and reassign their work first.`)) {
                              deleteMutation.mutate(u.id);
                            }
                          }}
                          aria-label={`Delete ${u.email}`}
                        >Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={userPage}
            total={usersData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => setUserPage((p) => Math.max(1, p - 1))}
            onNext={() => setUserPage((p) => p + 1)}
          />

          {/* ── Dialogs ── */}
          <CreateUserDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onSubmit={(input) => createMutation.mutate(input)}
            isPending={createMutation.isPending}
            error={(createMutation.error as Error | null)?.message ?? null}
          />

          <EditUserDialog
            user={editingUser}
            onClose={() => setEditingUser(null)}
            onSubmit={(fields) => editingUser && updateMutation.mutate({ id: editingUser.id, ...fields })}
            isPending={updateMutation.isPending}
            error={(updateMutation.error as Error | null)?.message ?? null}
          />

          <TempPasswordDialog
            data={tempPassword}
            onClose={() => setTempPassword(null)}
          />

          <UserRolesDialog
            user={rolesUser}
            token={token}
            onClose={() => setRolesUser(null)}
          />
        </div>
      )}

      {/* ── Workspaces ── */}
      {tab === 'workspaces' && (
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
                {(wsData?.workspaces ?? []).length === 0 && (
                  <tr><td colSpan={7} className={styles.empty}>No workspaces found</td></tr>
                )}
                {(wsData?.workspaces ?? []).map((w) => (
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
                                onChange={(e) => wsStatusMutation.mutate({ workspaceId: w.id, status: e.target.value })}
                                disabled={wsStatusMutation.isPending}
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
            page={wsPage}
            total={wsData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => setWsPage((p) => Math.max(1, p - 1))}
            onNext={() => setWsPage((p) => p + 1)}
          />
        </div>
      )}

      {/* ── Audit Log ── */}
      {tab === 'audit' && (
        <div id="panel-audit" role="tabpanel" aria-labelledby="tab-audit">
          <div className={styles.filterBar}>
            <label htmlFor="audit-resource" className="sr-only">Filter by resource</label>
            <select
              id="audit-resource"
              className={styles.filterSelect}
              value={auditResource}
              onChange={(e) => { setAuditResource(e.target.value); setAuditPage(1); }}
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
              value={auditAction}
              onChange={(e) => { setAuditAction(e.target.value); setAuditPage(1); }}
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
              value={auditFrom}
              onChange={(e) => { setAuditFrom(e.target.value); setAuditPage(1); }}
            />
            <label htmlFor="audit-to" className="sr-only">To date</label>
            <input
              id="audit-to"
              className={styles.dateInput}
              type="date"
              aria-label="To date"
              value={auditTo}
              onChange={(e) => { setAuditTo(e.target.value); setAuditPage(1); }}
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
                {(auditData?.entries ?? []).length === 0 && (
                  <tr><td colSpan={7} className={styles.empty}>No audit events found</td></tr>
                )}
                {(auditData?.entries ?? []).map((e) => (
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
            page={auditPage}
            total={auditData?.total ?? 0}
            pageSize={PAGE_SIZE}
            onPrev={() => setAuditPage((p) => Math.max(1, p - 1))}
            onNext={() => setAuditPage((p) => p + 1)}
          />
        </div>
      )}

      {/* ── Roles & Permissions ── */}
      {tab === 'roles' && (
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
// Wraps HTMLDialogElement so React can drive open/close declaratively. The
// browser handles focus trapping + Esc-to-close for free.
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

  // Reset on close so the next open starts fresh.
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
    // Only send fields that actually changed — patch semantics.
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
// Shown after admin-create (when no password supplied) and after reset-password.
// The plaintext only exists in this dialog — once dismissed it cannot be
// retrieved. Includes a copy-to-clipboard for accuracy.
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
          I've saved it
        </button>
      </div>
    </Dialog>
  );
}

// ─── Manage user's roles ──────────────────────────────────────────────────────
// Lists every role the user holds (system + workspace-scoped) and lets the
// admin assign/revoke. The same /admin/user-roles endpoints back the role-
// editor's Members section, so changes here invalidate that cache too.
function UserRolesDialog({
  user, token, onClose,
}: {
  user:    AdminUser | null;
  token:   string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
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

  // Hide assignments the user already has on the same workspace from the picker.
  const heldKeys = new Set(assignments.map((a) => `${a.roleId}:${a.workspaceId ?? ''}`));
  const candidateRoles = roles.filter((r) => {
    const key = `${r.id}:${r.scope === 'WORKSPACE' ? (pickWsId || '') : ''}`;
    // For workspace-scoped, only filter once a workspace is picked.
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
